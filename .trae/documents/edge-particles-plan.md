# 连接线粒子流动效果计划

## 一、目标

为画布连接线添加粒子流动效果，使连接线更具动态感和视觉吸引力。

## 二、技术方案

### 方案选择：SVG 粒子动画

使用 SVG 动画实现粒子沿路径流动，优点：
- 性能好（GPU 加速）
- 与现有 SVG 路径无缝集成
- 支持任意曲线路径
- 可控制粒子数量、速度、大小

### 实现原理

1. **路径解析**：从 `edgePath` (SVG path 字符串) 获取路径
2. **粒子生成**：创建多个圆点作为粒子
3. **动画绑定**：使用 `<animateMotion>` 让粒子沿路径移动
4. **错开时间**：每个粒子有不同的动画延迟，形成流动效果

## 三、实现步骤

### 步骤一：创建粒子流动组件

**新建文件**：`src/features/canvas/edges/EdgeParticles.tsx`

```tsx
import { memo, useMemo } from 'react';

interface EdgeParticlesProps {
  path: string;
  particleCount?: number;
  particleSize?: number;
  duration?: number;
  color?: string;
}

export const EdgeParticles = memo(function EdgeParticles({
  path,
  particleCount = 5,
  particleSize = 3,
  duration = 2,
  color = 'rgb(var(--accent-rgb) / 0.8)',
}: EdgeParticlesProps) {
  const particles = useMemo(() => {
    return Array.from({ length: particleCount }, (_, i) => ({
      id: i,
      delay: (i / particleCount) * duration,
    }));
  }, [particleCount, duration]);

  return (
    <g style={{ pointerEvents: 'none' }}>
      {particles.map((particle) => (
        <circle
          key={particle.id}
          r={particleSize}
          fill={color}
          opacity={0.8}
        >
          <animateMotion
            dur={`${duration}s`}
            repeatCount="indefinite"
            begin={`${particle.delay}s`}
            path={path}
          />
        </circle>
      ))}
    </g>
  );
});
```

### 步骤二：集成到 DisconnectableEdge

**修改文件**：`src/features/canvas/edges/DisconnectableEdge.tsx`

在连接线组件中添加粒子效果：
- 选中状态：显示粒子流动
- 处理中状态：显示粒子流动（已有虚线效果，可叠加或替换）

### 步骤三：添加配置选项

**修改文件**：`src/stores/settingsStore.ts`

添加设置项控制粒子效果：
- 开关：是否启用粒子效果
- 粒子数量：可调节
- 流动速度：可调节

### 步骤四：性能优化

1. **减少重渲染**：使用 `memo` 包裹组件
2. **限制粒子数量**：默认 5 个，最多 10 个
3. **条件渲染**：只在需要时显示粒子
4. **支持 prefers-reduced-motion**：尊重用户系统设置

## 四、视觉效果

### 粒子样式
- **形状**：圆形
- **大小**：3px（可配置）
- **颜色**：主题色半透明
- **数量**：5 个粒子（可配置）
- **速度**：2 秒一圈（可配置）

### 触发条件
- **选中连接线**：显示粒子流动
- **处理中状态**：显示粒子流动 + 虚线动画
- **普通连接线**：仅显示发光效果（无粒子）

## 五、文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/features/canvas/edges/EdgeParticles.tsx` | 新建 | 粒子流动组件 |
| `src/features/canvas/edges/DisconnectableEdge.tsx` | 修改 | 集成粒子效果 |
| `src/features/canvas/edges/index.ts` | 修改 | 导出新组件 |
| `src/stores/settingsStore.ts` | 修改 | 添加配置选项 |
| `src/index.css` | 修改 | 添加粒子相关样式 |

## 六、验证清单

- [ ] 粒子沿路径正确流动
- [ ] 选中连接线显示粒子效果
- [ ] 处理中状态粒子效果正常
- [ ] 性能无明显影响
- [ ] 支持 prefers-reduced-motion
- [ ] TypeScript 类型检查通过

## 七、执行顺序

```
步骤一 → 步骤二 → 步骤三 → 步骤四 → 验证
```
