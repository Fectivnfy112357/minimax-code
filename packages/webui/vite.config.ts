import { defineConfig } from "vite";

const serverPort = Number(process.env.WEBUI_SERVER_PORT ?? 8787);

export default defineConfig({
  root: "src/client",
  server: {
    port: Number(process.env.WEBUI_VITE_PORT ?? 5173),
    proxy: {
      "/ws": {
        target: `ws://127.0.0.1:${serverPort}`,
        ws: true,
      },
    },
  },
});
