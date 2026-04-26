export interface ShotParamOption {
  label: string;
  value: string;
  imageUrl: string | null;
}

export interface ShotParamCategory {
  id: "angle" | "height" | "shotSize" | "camera";
  title: string;
  options: ShotParamOption[];
}

export const SHOT_PARAM_CATEGORIES: ShotParamCategory[] = [
  {
    id: "angle",
    title: "拍摄方位",
    options: [
      { label: "正拍", value: "正拍", imageUrl: "/shot-params/angle-front.png" },
      { label: "正侧拍", value: "正侧拍", imageUrl: "/shot-params/angle-profile.webp" },
      { label: "斜侧拍", value: "斜侧拍", imageUrl: "/shot-params/angle-three-quarter.png" },
      { label: "背拍", value: "背拍", imageUrl: "/shot-params/angle-back.webp" },
    ],
  },
  {
    id: "height",
    title: "拍摄高度",
    options: [
      { label: "平拍", value: "平拍", imageUrl: "/shot-params/height-eye-level.webp" },
      { label: "仰拍", value: "仰拍", imageUrl: "/shot-params/height-low-angle.webp" },
      { label: "俯拍", value: "俯拍", imageUrl: "/shot-params/height-high-angle.webp" },
    ],
  },
  {
    id: "shotSize",
    title: "拍摄距离/景别",
    options: [
      { label: "远景", value: "远景", imageUrl: "/shot-params/shot-long.webp" },
      { label: "全景", value: "全景", imageUrl: "/shot-params/shot-full.webp" },
      { label: "中景", value: "中景", imageUrl: "/shot-params/shot-medium.webp" },
      { label: "近景", value: "近景", imageUrl: "/shot-params/shot-medium-close.webp" },
      { label: "特写", value: "特写", imageUrl: "/shot-params/shot-close-up.webp" },
    ],
  },
  {
    id: "camera",
    title: "运镜偏好",
    options: [
      { label: "缓慢推镜", value: "缓慢推镜", imageUrl: "/shot-params/camera-slow-push.webp" },
      { label: "缓慢拉远", value: "缓慢拉远", imageUrl: "/shot-params/camera-slow-pull.webp" },
      { label: "向左摇镜", value: "向左摇镜", imageUrl: "/shot-params/camera-pan-left.webp" },
      { label: "向右摇镜", value: "向右摇镜", imageUrl: "/shot-params/camera-pan-right.webp" },
      { label: "向上仰视", value: "向上仰视", imageUrl: "/shot-params/camera-tilt-up.webp" },
      { label: "向下俯视", value: "向下俯视", imageUrl: "/shot-params/camera-tilt-down.webp" },
      { label: "360环绕", value: "360度环绕", imageUrl: "/shot-params/camera-360-orbit.webp" },
      { label: "FPV穿越", value: "FPV穿越机", imageUrl: "/shot-params/camera-fpv.webp" },
      { label: "手持呼吸", value: "手持呼吸感", imageUrl: "/shot-params/camera-handheld.webp" },
      { label: "平滑跟随", value: "斯坦尼康跟随", imageUrl: "/shot-params/camera-steadicam.webp" },
      { label: "快速急推", value: "快速急推", imageUrl: "/shot-params/camera-fast-push.webp" },
      { label: "希区柯克", value: "希区柯克变焦", imageUrl: "/shot-params/camera-dolly-zoom.webp" },
      { label: "微距特写", value: "微距特写", imageUrl: "/shot-params/camera-macro.webp" },
      { label: "子弹时间", value: "子弹时间", imageUrl: "/shot-params/camera-bullet-time.webp" },
      { label: "分屏效果", value: "分屏效果", imageUrl: "/shot-params/camera-split-screen.webp" },
    ],
  },
];
