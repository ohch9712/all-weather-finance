import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // 화면 문구·형식 함수는 KST 기준이다. 테스트 머신의 시간대와 무관하게 같은 결과를 내도록 UTC로 고정한다.
    env: { TZ: "UTC" },
  },
});
