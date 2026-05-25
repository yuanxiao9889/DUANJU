declare module 'bezier-easing-editor' {
  import type { ComponentType, CSSProperties } from 'react';

  export type BezierEditorValue = [number, number, number, number];

  export interface BezierEditorProps {
    value?: BezierEditorValue;
    defaultValue?: BezierEditorValue;
    onChange?: (value: BezierEditorValue) => void;
    width?: number;
    height?: number;
    padding?: [number, number, number, number];
    handleRadius?: number;
    style?: CSSProperties;
    className?: string;
    progress?: number;
    handleStroke?: number;
    background?: string;
    gridColor?: string;
    curveColor?: string;
    curveWidth?: number;
    handleColor?: string;
    color?: string;
    textStyle?: CSSProperties;
    progressColor?: string;
    readOnly?: boolean;
  }

  const BezierEditor: ComponentType<BezierEditorProps>;
  export default BezierEditor;
}
