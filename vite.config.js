import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const ALPACA_API_KEY = process.env.ALPACA_API_KEY || "PKFJY5TRMF36BGN76LPRGRUKTO";
const ALPACA_SECRET_KEY = process.env.ALPACA_SECRET_KEY || "";

const alpacaHeaders = {
  "APCA-API-KEY-ID": ALPACA_API_KEY,
  "APCA-API-SECRET-KEY": ALPACA_SECRET_KEY,
};

// Netlify Dev runs functions on 9999 by default
const NETLIFY_FUNCTIONS_URL = "http://localhost:9999";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Trading bot endpoints -> Netlify functions (in dev, handled by netlify dev)
      // In production, Netlify routes these via function config paths
      "/api/trading-bot": {
        target: NETLIFY_FUNCTIONS_URL,
        changeOrigin: true,
      },
      // Alpaca broker API - account endpoints
      "/api/account/portfolio/history": {
        target: "https://paper-api.alpaca.markets/v2",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: alpacaHeaders,
      },
      "/api/account/activities": {
        target: "https://paper-api.alpaca.markets/v2",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: alpacaHeaders,
      },
      "/api/account": {
        target: "https://paper-api.alpaca.markets/v2",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: alpacaHeaders,
      },
      // Alpaca broker API - other endpoints
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
      // Alpaca data API - crypto bars/snapshots
      "/api/crypto": {
        target: "https://data.alpaca.markets/v1beta3",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
        headers: alpacaHeaders,
      },
    },
  },
});
