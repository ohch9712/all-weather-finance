import { useId } from "react";
import { cn } from "@/lib/utils";

// 로고 평면 마크. public/brand/logo-mark.svg와 같은 그림(타일 없이 네 조각 링)을 인라인 SVG로 그려 추가 요청이 없다.
// 장식용이라 보조기기에서 숨기고, 옆에 놓인 서비스 이름 글자가 접근 가능한 이름이 된다.
// 색은 로고 원본 색이다(자산군 색 토큰과 무관하다). 그라데이션 id는 useId로 만들어 한 화면에 여러 개를 둬도 겹치지 않는다.

const RING_CENTER = { cx: 254.5, cy: 254.5, r: 177 } as const;

export const LOGO_MARK_VIEW_BOX = "74.5 74.5 360 360";

export const LOGO_MARK_PATHS = {
  green:
    "M427.9 219.2A177 177 0 0 0 280 79.4A14 14 0 0 0 264.8 97.9A42 54 -11.5 0 1 261.6 149.3A6 6 0 0 0 266.1 158.2A97 97 0 0 1 349.5 235.1A33.5 43 78.5 0 0 398.4 259.4A33.5 37 78.5 0 0 427.9 219.2Z",
  blue: "M219.2 81.1A177 177 0 0 0 79.4 229A14 14 0 0 0 97.9 244.2A42 54 -101.5 0 1 149.3 247.4A6 6 0 0 0 158.2 242.9A97 97 0 0 1 235.1 159.5A33.5 43 -11.5 0 0 259.4 110.6A33.5 37 -11.5 0 0 219.2 81.1Z",
  yellow:
    "M81.1 289.8A177 177 0 0 0 229 429.6A14 14 0 0 0 244.2 411.1A42 54 -191.5 0 1 247.4 359.7A6 6 0 0 0 242.9 350.8A97 97 0 0 1 159.5 273.9A33.5 43 -101.5 0 0 110.6 249.6A33.5 37 -101.5 0 0 81.1 289.8Z",
  red: "M289.8 427.9A177 177 0 0 0 429.6 280A14 14 0 0 0 411.1 264.8A42 54 -281.5 0 1 359.7 261.6A6 6 0 0 0 350.8 266.1A97 97 0 0 1 273.9 349.5A33.5 43 -191.5 0 0 249.6 398.4A33.5 37 -191.5 0 0 289.8 427.9Z",
} as const;

interface LogoMarkProps {
  /** 크기 등 덧붙일 클래스. 기본 크기는 size-5다. */
  className?: string;
}

export function LogoMark({ className }: LogoMarkProps) {
  const id = useId();
  const fill = (key: string) => `url(#${id}-${key})`;
  return (
    <svg
      viewBox={LOGO_MARK_VIEW_BOX}
      aria-hidden="true"
      data-slot="logo-mark"
      className={cn("size-5 shrink-0", className)}
    >
      <defs>
        <linearGradient id={`${id}-b`} x1="224.6" y1="85.1" x2="156" y2="237.1" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#43b1fc" />
          <stop offset=".5" stopColor="#339dfc" />
          <stop offset="1" stopColor="#1a7afc" />
        </linearGradient>
        <radialGradient id={`${id}-g`} {...RING_CENTER} gradientUnits="userSpaceOnUse">
          <stop offset=".55" stopColor="#1fbc89" />
          <stop offset=".77" stopColor="#2bc692" />
          <stop offset="1" stopColor="#35d298" />
        </radialGradient>
        <linearGradient id={`${id}-y`} x1="118.8" y1="273.6" x2="218.7" y2="422.7" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffd634" />
          <stop offset=".5" stopColor="#fdc220" />
          <stop offset="1" stopColor="#ffaf14" />
        </linearGradient>
        <radialGradient id={`${id}-r`} {...RING_CENTER} gradientUnits="userSpaceOnUse">
          <stop offset=".55" stopColor="#fd7e5e" />
          <stop offset=".77" stopColor="#fc7557" />
          <stop offset="1" stopColor="#fd684d" />
        </radialGradient>
      </defs>
      <path fill={fill("g")} d={LOGO_MARK_PATHS.green} />
      <path fill={fill("b")} d={LOGO_MARK_PATHS.blue} />
      <path fill={fill("y")} d={LOGO_MARK_PATHS.yellow} />
      <path fill={fill("r")} d={LOGO_MARK_PATHS.red} />
    </svg>
  );
}
