import type { CSSProperties } from "react";
import { preload } from "react-dom";
import s from "./logo.module.css";

// ログイン画面のロゴ。絵ができるまでを一度だけ見せて(約3秒)、最後は元のロゴ(public/brand/mark.png・wordmark.png)そのものになる。
//   十字の軸が中心から伸びる → 軸の先の点と点線の軌道が出る → 3本のリボンを光の線でなぞる → 絵の全体が中心から広がる → 文字が出る
// 線と点は、元の絵を少しずつ見せる「マスク」に使う。見えているのはいつも元の絵なので、最後に継ぎ目なく元のロゴになる。
//   軸・点線・点は mark-lines.png(細い線と点だけの絵)から、リボンは mark.png から見せる(点線の通り道でリボンが四角く欠けて見えないように)
// 座標は元の画像(tools/brand/4db-logo.webp、1254×1254)の px。切り出し位置と点の位置は tools/brand/build.mjs の MARK・WORD・DOTS と同じ。
// 線の位置は元の画像からなぞったもの。動きを減らす設定(prefers-reduced-motion)では、最初から完成したロゴを出す。

const MARK = { x: 64, y: 24, width: 1126, height: 928 };
const WORD = { x: 64, y: 952, width: 1126, height: 198 };
const CENTER = { x: 626, y: 533 };

/** アニメーションの開始(秒)と長さ(秒)。CSS の --d・--t に渡す */
const at = (delay: number, duration?: number) =>
  ({ "--d": `${delay}s`, ...(duration === undefined ? {} : { "--t": `${duration}s` }) }) as CSSProperties;

// 十字の軸(中心から4方向へ)
const AXES = [`M${CENTER.x} ${CENTER.y}H80`, `M${CENTER.x} ${CENTER.y}H1180`, `M${CENTER.x} ${CENTER.y}V34`, `M${CENTER.x} ${CENTER.y}V950`];

// 点線の軌道(元の画像の点線をなぞったもの)。[線, 開始, 長さ]
const ORBITS: [string, number, number][] = [
  ["M546 160C559 161 597 160 626 164C655 168 690 176 720 183C750 190 784 194 806 205C828 216 840 232 854 247C868 262 880 279 890 296C900 313 903 334 916 348C929 362 952 367 967 380C982 393 991 410 1005 424C1019 438 1035 449 1049 463C1063 477 1085 493 1091 510C1097 527 1092 549 1083 566C1074 583 1050 593 1038 610C1027 627 1024 649 1014 666C1004 683 990 701 979 714C968 727 953 738 948 743", 0.45, 0.85],
  ["M546 163C536 166 506 172 488 180C470 188 455 197 440 209C425 221 411 235 398 250C385 265 374 282 363 299C353 316 343 333 335 352C327 371 318 397 313 411C308 426 307 434 306 439", 0.5, 0.6],
  ["M689 342C680 336 653 318 635 308C617 298 600 288 582 280C564 272 547 265 528 259C509 253 489 248 470 246C451 244 431 242 412 245C393 248 373 255 354 263C335 271 313 278 298 291C283 304 270 325 264 343C258 362 262 384 264 402C267 421 277 445 279 454", 0.55, 0.7],
  ["M239 601C244 611 255 641 266 659C277 677 293 692 305 708C318 725 330 741 341 758C352 775 359 795 372 810C385 825 398 837 418 848C438 859 465 869 490 876C515 883 543 887 570 890C597 893 623 893 650 893C677 893 712 891 730 890C748 889 755 888 760 887", 0.6, 0.75],
  ["M547 160C543 169 530 193 524 212C518 231 514 256 511 275C508 294 505 317 504 325", 0.7, 0.35],
  ["M328 728C333 731 349 739 360 743C371 747 383 748 395 750C407 752 418 753 430 754C442 755 459 757 465 757", 0.8, 0.35],
  ["M735 745C740 748 753 756 762 761C771 766 780 770 789 773C798 776 811 778 818 780C825 782 828 783 830 783", 0.85, 0.3],
  ["M814 319C819 319 833 319 843 320C853 321 863 322 873 325C883 328 895 334 901 337C908 340 910 341 912 342", 0.8, 0.3],
];

// 3本のリボン(縦に長い輪・横に広い輪・斜めの輪)。width はマスクの太さ。リボンの芯だけを見せる細さにして、ふちはぼかす
// (太いと、交わるほかのリボンが四角く切り取られて見えるため)。ふちの残りは最後に全体を出すときに出る
const RIBBONS = [
  { id: "a", d: "M690.8 105.5A165 388 5 0 0 623.2 878.5A165 388 5 0 0 690.8 105.5", width: 32, delay: 0.6, duration: 1.0 },
  { id: "b", d: "M244 576.7A412 95 -4 0 0 1066 519.3A412 95 -4 0 0 244 576.7", width: 36, delay: 0.72, duration: 1.0 },
  { id: "c", d: "M300 560C289 545 240 500 232 470C224 440 230 401 250 380C270 359 308 348 350 345C392 342 458 351 500 362C542 373 567 392 600 410C633 428 667 445 700 470C733 495 770 532 800 560C830 588 859 613 880 640C901 667 922 695 925 720C928 745 914 771 900 790C886 809 867 823 840 835C813 847 773 856 740 862C707 868 677 872 640 872C603 872 555 866 520 860C485 854 451 847 430 835C409 823 397 805 395 790C393 775 408 760 420 745C433 730 448 719 470 700C492 681 522 656 550 630C578 604 612 573 640 545C668 517 698 488 720 460C743 433 762 407 775 380C788 353 796 313 800 300", width: 42, delay: 0.8, duration: 1.2 },
];

// 点(中心の光・上の光・軸の先の点・軌道の上の点)。[x, y, 半径(光のにじみを含む), 開始]
const DOTS: [number, number, number, number][] = [
  [626, 532, 20, 0.1], [624, 164, 14, 0.6],
  [626, 78, 22, 0.5], [626, 912, 22, 0.5], [168, 534, 20, 0.45], [1098, 532, 20, 0.45],
  [546, 160, 22, 0.5], [914, 342, 22, 0.9], [294, 296, 14, 0.95], [290, 694, 14, 0.9], [328, 728, 22, 0.95],
];

const ID = "login-logo";

export function LoginLogo() {
  preload("/brand/mark.png", { as: "image", fetchPriority: "high" });
  preload("/brand/mark-lines.png", { as: "image" });
  preload("/brand/wordmark.png", { as: "image" });
  const full = { x: MARK.x, y: MARK.y, width: MARK.width, height: MARK.height };
  return (
    <div className={s.logo} aria-hidden="true">
      <svg className={s.art} viewBox={`${MARK.x} ${MARK.y} ${MARK.width} ${MARK.width}`} focusable="false">
        <defs>
          <filter id={`${ID}-soft`} filterUnits="userSpaceOnUse" {...full}>
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <filter id={`${ID}-feather`} filterUnits="userSpaceOnUse" {...full}>
            <feGaussianBlur stdDeviation="9" />
          </filter>
          <filter id={`${ID}-glow`} filterUnits="userSpaceOnUse" {...full}>
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id={`${ID}-dot`}>
            <stop offset="0.6" stopColor="#fff" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${ID}-fin`}>
            <stop offset="0.7" stopColor="#fff" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${ID}-wipe`}>
            <stop offset="0.64" stopColor="#fff" />
            <stop offset="0.7" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${ID}-pen-a`} gradientUnits="userSpaceOnUse" x1="480" y1="0" x2="830" y2="0">
            <stop offset="0" stopColor="#8db9ff" />
            <stop offset="1" stopColor="#f7d9a8" />
          </linearGradient>
          <linearGradient id={`${ID}-pen-b`} gradientUnits="userSpaceOnUse" x1="244" y1="0" x2="1066" y2="0">
            <stop offset="0" stopColor="#f3c98f" />
            <stop offset="0.45" stopColor="#8db9ff" />
            <stop offset="1" stopColor="#ffe2b0" />
          </linearGradient>
          <linearGradient id={`${ID}-pen-c`} gradientUnits="userSpaceOnUse" x1="250" y1="350" x2="600" y2="860">
            <stop offset="0" stopColor="#8db9ff" />
            <stop offset="1" stopColor="#f7cf94" />
          </linearGradient>
          {/* 絵を見せる範囲。白いところだけ絵が見える。軸・点線・点(mark-lines.png) */}
          <mask id={`${ID}-lines`} maskUnits="userSpaceOnUse" {...full}>
            <g filter={`url(#${ID}-soft)`} fill="none" stroke="#fff">
              {AXES.map((d) => <path key={d} d={d} pathLength={1} strokeWidth={12} className={s.draw} style={at(0.15, 0.6)} />)}
              {ORBITS.map(([d, delay, duration]) => <path key={d} d={d} pathLength={1} strokeWidth={44} className={s.draw} style={at(delay, duration)} />)}
            </g>
            {DOTS.map(([x, y, r, delay]) => <circle key={`${x},${y}`} cx={x} cy={y} r={r + 8} fill={`url(#${ID}-dot)`} className={s.pop} style={at(delay)} />)}
          </mask>
          {/* リボン(mark.png)。最後に全体を中心から広げて、元の絵そのものにする。
              リボンを描くたびに、まだ描いていないリボンの通り道を黒で消す(編み目のように)。
              交わる所は、あとのリボンが通ったときに出るので、描いていないリボンの切れ端が先に見えない */}
          <mask id={`${ID}-reveal`} maskUnits="userSpaceOnUse" {...full}>
            <g filter={`url(#${ID}-feather)`} fill="none" strokeLinecap="round">
              {RIBBONS.flatMap((r, i) => [
                <path key={r.id} d={r.d} pathLength={1} stroke="#fff" strokeWidth={r.width} className={`${s.draw} ${s.ribbon}`} style={at(r.delay, r.duration)} />,
                ...RIBBONS.slice(i + 1).map((later) => <path key={`${r.id}-${later.id}`} d={later.d} stroke="#000" strokeWidth={later.width + 36} />),
              ])}
            </g>
            <circle cx={CENTER.x} cy={500} r={1100} fill={`url(#${ID}-fin)`} className={s.finale} />
          </mask>
          <mask id={`${ID}-wordmask`} maskUnits="userSpaceOnUse" {...WORD}>
            <rect x={WORD.x - WORD.width} y={WORD.y} width={WORD.width * 3} height={WORD.height} fill={`url(#${ID}-wipe)`} className={s.wipe} />
          </mask>
        </defs>
        <image href="/brand/mark-lines.png" {...full} preserveAspectRatio="none" mask={`url(#${ID}-lines)`} className={s.lines} />
        <image href="/brand/mark.png" {...full} preserveAspectRatio="none" mask={`url(#${ID}-reveal)`} />
        {/* 下書きの光の線。絵がそろうと消える */}
        <g filter={`url(#${ID}-glow)`} fill="none" strokeLinecap="round">
          {AXES.map((d) => <path key={d} d={d} pathLength={1} stroke="#f4d6a6" strokeWidth={3} className={`${s.draw} ${s.pen}`} style={at(0.15, 0.6)} />)}
          {RIBBONS.map((r) => (
            <g key={r.id}>
              <path d={r.d} pathLength={1} stroke={`url(#${ID}-pen-${r.id})`} strokeWidth={5} className={`${s.draw} ${s.ribbon} ${s.pen}`} style={at(r.delay, r.duration)} />
              <path d={r.d} pathLength={1} stroke="#fffaf0" strokeWidth={7} className={`${s.head} ${s.ribbon}`} style={at(r.delay, r.duration)} />
            </g>
          ))}
          <path d={`M${CENTER.x} ${CENTER.y - 40}L${CENTER.x + 7} ${CENTER.y - 7}L${CENTER.x + 40} ${CENTER.y}L${CENTER.x + 7} ${CENTER.y + 7}L${CENTER.x} ${CENTER.y + 40}L${CENTER.x - 7} ${CENTER.y + 7}L${CENTER.x - 40} ${CENTER.y}L${CENTER.x - 7} ${CENTER.y - 7}Z`} fill="#fff7e6" className={s.spark} />
        </g>
        <image href="/brand/wordmark.png" {...WORD} preserveAspectRatio="none" mask={`url(#${ID}-wordmask)`} className={s.word} />
      </svg>
    </div>
  );
}
