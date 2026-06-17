import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'en-US',
  title: 'ZX Vibes Manual',
  description: 'Build, test, debug, and preview ZX Spectrum projects with zx-vibes.',
  base: '/zx-vibes/manual/',
  cacheDir: '../../node_modules/.vitepress/manual-cache',
  outDir: '../../gallery/manual',
  cleanUrls: true,
  lastUpdated: true,
  vite: {
    build: {
      target: 'esnext',
    },
    optimizeDeps: {
      esbuildOptions: {
        target: 'esnext',
      },
    },
  },
  themeConfig: {
    nav: [
      { text: 'Manual', link: '/' },
      { text: 'Gallery', link: 'https://alvaromah.github.io/zx-vibes/' },
      { text: 'GitHub', link: 'https://github.com/Alvaromah/zx-vibes' },
    ],
    sidebar: [
      {
        text: 'Start',
        items: [
          { text: 'Overview', link: '/' },
          { text: 'Installation', link: '/installation' },
          { text: 'Create a Project', link: '/create-project' },
          { text: 'First Build', link: '/first-build' },
        ],
      },
      {
        text: 'Workflows',
        items: [
          { text: 'Agent Workflow', link: '/agent-workflow' },
          { text: 'MCP', link: '/mcp' },
          { text: 'Manual CLI Workflow', link: '/manual-workflow' },
          { text: 'Debugging', link: '/debugging' },
          { text: 'Testing', link: '/testing' },
          { text: 'Preview and Play', link: '/preview-play' },
        ],
      },
      {
        text: 'Reference',
        items: [{ text: 'Troubleshooting', link: '/troubleshooting' }],
      },
    ],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'ZX Spectrum 48K agent workflow documentation.',
      copyright: 'Released under the MIT License.',
    },
  },
});
