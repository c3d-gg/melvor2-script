using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace MelvorScript.Runtime;

/// <summary>
/// WebSocket JSON-RPC server on 127.0.0.1. Same wire format as melvor-script (Melvor 1):
///   client -> server { id, method, params }      server -> client { id, result } | { id, error }
///   server -> client { method, params }          (notification)
/// Auth: ws://127.0.0.1:PORT/ws?token=TOKEN. Requests with an Origin header (browsers) are refused.
/// </summary>
internal sealed class WsServer(Config config, Func<Client, string, JsonNode?, Task<JsonNode?>> dispatch)
{
    private TcpListener? _listener;
    private readonly CancellationTokenSource _stop = new();
    private readonly List<Client> _clients = new();

    public IReadOnlyList<Client> Clients { get { lock (_clients) return _clients.ToArray(); } }

    public void Start()
    {
        _listener = new TcpListener(IPAddress.Loopback, config.Port);
        _listener.Start();
        Log.Info($"listening on ws://127.0.0.1:{config.Port}/ws", toGame: true);
        _ = Task.Run(AcceptLoop);
    }

    public void Stop()
    {
        _stop.Cancel();
        try { _listener?.Stop(); } catch { }
        foreach (var c in Clients) c.Abort();
    }

    public void Broadcast(string method, JsonNode? @params)
    {
        string text = new JsonObject { ["method"] = method, ["params"] = @params?.DeepClone() }.ToJsonString();
        foreach (var c in Clients) _ = c.SendAsync(text);
    }

    private async Task AcceptLoop()
    {
        while (!_stop.IsCancellationRequested)
        {
            TcpClient tcp;
            try { tcp = await _listener!.AcceptTcpClientAsync(_stop.Token).ConfigureAwait(false); }
            catch (OperationCanceledException) { return; }
            catch (Exception e) { Log.Error("accept failed", e); continue; }
            _ = Task.Run(() => Serve(tcp));
        }
    }

    private async Task Serve(TcpClient tcp)
    {
        tcp.NoDelay = true;
        var stream = tcp.GetStream();
        Client? client = null;
        try
        {
            var (path, headers) = await ReadRequest(stream).ConfigureAwait(false);
            if (headers.ContainsKey("origin")) { await Refuse(stream, 403, "browsers may not connect"); return; }
            if (!headers.TryGetValue("upgrade", out var up) || !up.Equals("websocket", StringComparison.OrdinalIgnoreCase)
                || !headers.TryGetValue("sec-websocket-key", out var key))
            { await Refuse(stream, 400, "expected a WebSocket upgrade"); return; }
            string? token = null;
            int q = path.IndexOf('?');
            if (q >= 0)
                foreach (var part in path[(q + 1)..].Split('&'))
                    if (part.StartsWith("token=")) token = Uri.UnescapeDataString(part[6..]);
            if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(token ?? ""), Encoding.UTF8.GetBytes(config.Token)))
            { await Refuse(stream, 401, "bad token"); return; }

            string accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
            await stream.WriteAsync(Encoding.ASCII.GetBytes(
                "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
                $"Sec-WebSocket-Accept: {accept}\r\n\r\n")).ConfigureAwait(false);

            var ws = WebSocket.CreateFromStream(stream, new WebSocketCreationOptions { IsServer = true, KeepAliveInterval = TimeSpan.FromSeconds(20) });
            client = new Client(ws);
            lock (_clients) _clients.Add(client);
            Log.Info($"client #{client.Id} connected");
            await ReceiveLoop(client).ConfigureAwait(false);
        }
        catch (Exception e) when (e is IOException or WebSocketException or OperationCanceledException)
        {
            // connection dropped
        }
        catch (Exception e)
        {
            Log.Error("connection failed", e);
        }
        finally
        {
            if (client != null)
            {
                lock (_clients) _clients.Remove(client);
                Log.Info($"client #{client.Id} ({client.Name}) disconnected");
            }
            tcp.Dispose();
        }
    }

    private async Task ReceiveLoop(Client client)
    {
        var buffer = new byte[64 * 1024];
        var message = new MemoryStream();
        while (client.Socket.State == WebSocketState.Open)
        {
            var r = await client.Socket.ReceiveAsync(buffer, _stop.Token).ConfigureAwait(false);
            if (r.MessageType == WebSocketMessageType.Close)
            {
                await client.Socket.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "bye", CancellationToken.None).ConfigureAwait(false);
                return;
            }
            message.Write(buffer, 0, r.Count);
            if (message.Length > 1 << 20) throw new IOException("message too large");
            if (!r.EndOfMessage) continue;
            string text = Encoding.UTF8.GetString(message.GetBuffer(), 0, (int)message.Length);
            message.SetLength(0);
            _ = Task.Run(() => Handle(client, text));
        }
    }

    private async Task Handle(Client client, string text)
    {
        JsonNode? id = null;
        try
        {
            var req = JsonNode.Parse(text) as JsonObject ?? throw new RpcException("BAD_REQUEST", "expected a JSON object");
            id = req["id"]?.DeepClone();
            string method = req["method"]?.GetValue<string>() ?? throw new RpcException("BAD_REQUEST", "missing method");
            if (!client.AllowCall()) throw new RpcException("RATE_LIMITED", "more than 60 calls per second");
            JsonNode? result = await dispatch(client, method, req["params"]).ConfigureAwait(false);
            if (id != null) await client.SendAsync(new JsonObject { ["id"] = id, ["result"] = result }.ToJsonString()).ConfigureAwait(false);
        }
        catch (Exception e)
        {
            var (code, message, data) = e switch
            {
                RpcException r => (r.Code, r.Message, r.Payload?.DeepClone()),
                System.Text.Json.JsonException => ("BAD_REQUEST", "invalid JSON: " + e.Message, null),
                InvalidOperationException => ("BAD_REQUEST", e.Message, null),
                _ => ("FAILED", e.GetType().Name + ": " + e.Message, null),
            };
            if (e is not RpcException) Log.Error("call failed: " + text, e);
            if (id != null)
                await client.SendAsync(new JsonObject
                {
                    ["id"] = id,
                    ["error"] = new JsonObject { ["code"] = code, ["message"] = message, ["data"] = data },
                }.ToJsonString()).ConfigureAwait(false);
        }
    }

    private static async Task<(string path, Dictionary<string, string> headers)> ReadRequest(NetworkStream stream)
    {
        var buf = new byte[8192];
        int len = 0;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (true)
        {
            if (len == buf.Length) throw new IOException("request too large");
            int n = await stream.ReadAsync(buf.AsMemory(len), timeout.Token).ConfigureAwait(false);
            if (n == 0) throw new IOException("closed during handshake");
            len += n;
            string sofar = Encoding.ASCII.GetString(buf, 0, len);
            int end = sofar.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (end < 0) continue;
            var lines = sofar[..end].Split("\r\n");
            var first = lines[0].Split(' ');
            if (first.Length < 2 || first[0] != "GET") throw new IOException("not a GET request");
            var headers = new Dictionary<string, string>();
            foreach (var line in lines.Skip(1))
            {
                int c = line.IndexOf(':');
                if (c > 0) headers[line[..c].Trim().ToLowerInvariant()] = line[(c + 1)..].Trim();
            }
            return (first[1], headers);
        }
    }

    private static async Task Refuse(NetworkStream stream, int status, string reason)
    {
        Log.Info($"refused a connection: {status} {reason}");
        string body = reason;
        await stream.WriteAsync(Encoding.ASCII.GetBytes(
            $"HTTP/1.1 {status} {reason}\r\nContent-Type: text/plain\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n{body}"));
    }
}

internal sealed class Client(WebSocket socket)
{
    private static int _nextId;
    private readonly SemaphoreSlim _send = new(1, 1);
    private readonly Queue<long> _calls = new();

    public int Id { get; } = Interlocked.Increment(ref _nextId);
    public WebSocket Socket { get; } = socket;
    public string Name { get; set; } = "script";

    public bool AllowCall()
    {
        long now = Environment.TickCount64;
        lock (_calls)
        {
            while (_calls.Count > 0 && now - _calls.Peek() > 1000) _calls.Dequeue();
            if (_calls.Count >= 60) return false;
            _calls.Enqueue(now);
            return true;
        }
    }

    public async Task SendAsync(string text)
    {
        await _send.WaitAsync().ConfigureAwait(false);
        try
        {
            if (Socket.State == WebSocketState.Open)
                await Socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, CancellationToken.None).ConfigureAwait(false);
        }
        catch (Exception e) when (e is WebSocketException or IOException or ObjectDisposedException) { }
        finally { _send.Release(); }
    }

    public void Abort() { try { Socket.Abort(); } catch { } }
}
