// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { unified } from '@astrojs/markdown-remark';
import remarkBase from './plugins/remark-base.mjs';

// Served from GitHub Pages at https://c3d-gg.github.io/melvor2-script/. Pages link to each other
// with plain absolute paths (/guides/combat/); remark-base adds the /melvor2-script prefix.
const site = 'https://c3d-gg.github.io';
const base = '/melvor2-script';
const repo = 'https://github.com/c3d-gg/melvor2-script';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  // Starlight's asides, steps and tabs are remark plugins, so the Markdown processor is unified (remark).
  markdown: { processor: unified({ remarkPlugins: [[remarkBase, { base }]] }) },
  vite: { server: { fs: { allow: ['..'] } } },
  integrations: [
    starlight({
      title: 'Melvor2 Script',
      description: 'Play Melvor Idle 2 by writing TypeScript.',
      logo: { src: './src/assets/logo.svg', replacesTitle: false },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/site/` },
      customCss: ['./src/styles/custom.css'],
      lastUpdated: false,
      expressiveCode: {
        themes: ['github-dark-default', 'github-light'],
        styleOverrides: { borderRadius: '0.5rem' },
        // Wrap long lines instead of scrolling sideways; wrapped lines keep their indent.
        defaultProps: { wrap: true, preserveIndent: true },
      },
      components: {
        // The reference is generated: "Edit page" should point at the doc comments instead.
        EditLink: './src/components/EditLink.astro',
      },
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Quick start', slug: 'start/quick-start' },
            { label: 'How it works', slug: 'concepts/how-it-works' },
            { label: 'Real time', slug: 'concepts/real-time' },
            { label: 'Scripted Mode', slug: 'concepts/scripted-mode' },
          ],
        },
        { label: 'Learn to code', items: [{ autogenerate: { directory: 'learn' } }] },
        { label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
        { label: 'Reference', collapsed: false, items: [{ autogenerate: { directory: 'reference' } }] },
        {
          label: 'Project',
          items: [
            { label: 'Roadmap', slug: 'roadmap' },
            { label: 'Changelog', slug: 'changelog' },
          ],
        },
      ],
    }),
  ],
});
