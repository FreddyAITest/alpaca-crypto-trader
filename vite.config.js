import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const ALPACA_KEY = process.env.ALPACA_API_KEY || "PKFJY5TRMF36BGN76LPRGRUKTO";
const ALPACA_SECRET = process.env.ALPACA_SECRET_KEY || "";

const alpacaHeaders = {
  "APCA-API-KEY-ID": ALPACA_KEY,
  "APCA-API-SECRET-KEY": ALPACA_SECRET,
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api/account": {
        target: "https://paper-api.alpaca.markets/v2",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: alpacaHeaders,
      },
      "/api/positions": {
        target: "https://paper-api.alpaca.markets/v2",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: alpacaHeaders,
      },
      "/api/orders": {
        target: "https://paper-api.alpaca.markets/v2",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: alpacaHeaders,
      },
      "/api/assets": {
        target: "https://paper-api.alpaca.markets/v2",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: alpacaHeaders,
      },
      "/api/crypto": {
        target: "https://data.alpaca.markets/v1beta3",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: alpacaHeaders,
      },
    },
  },
});
