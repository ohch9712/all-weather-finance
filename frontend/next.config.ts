import type { NextConfig } from "next";

// cacheComponents·partialPrefetching은 쓰지 않는다. 데이터는 모두 클라이언트에서 불러오고,
// Activity가 숨긴 이전 경로 상태가 다른 사용자에게 남지 않게 기존 언마운트 동작을 쓴다(architecture 12절).
const nextConfig: NextConfig = {};

export default nextConfig;
