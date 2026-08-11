import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// During local development, `npm run dev` proxies /api/* to your deployed
// Vercel backend so you can test the real endpoints (auth, create-pet,
// pet-action, player-state, set-pet-appearance) without redeploying.
// Set VITE_API_ORIGIN in a .env.local file, e.g.:
//   VITE_API_ORIGIN=https://your-project.vercel.app
export default defineConfig(({ mode }) => {
  const apiOrigin = process.env.VITE_API_ORIGIN || 'http://localhost:3000';
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: apiOrigin,
          changeOrigin: true,
        },
      },
    },
  };
});
