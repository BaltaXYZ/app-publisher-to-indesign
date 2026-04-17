export interface DesignColor {
  hex: string;
}

export interface DesignParagraphStyle {
  id: string;
  align?: string;
  marginTopPt?: number;
  marginBottomPt?: number;
  lineHeight?: string;
}

export interface DesignCharacterStyle {
  id: string;
  fontFamily?: string;
  fontSizePt?: number;
  fontWeight?: string;
  fontStyle?: string;
  color?: DesignColor;
}

export interface DesignGraphicStyle {
  id: string;
  fill?: "none" | "solid" | "bitmap";
  fillColor?: DesignColor;
  fillImageName?: string;
  stroke?: string;
}

export interface DesignImageFill {
  name: string;
  path: string;
}

export interface DesignTextRun {
  text: string;
  characterStyleId?: string;
  fontFamily?: string;
  fontSizePt?: number;
  color?: DesignColor;
}

export interface DesignParagraph {
  styleId?: string;
  runs: DesignTextRun[];
}

export interface DesignTextFrame {
  kind: "textFrame";
  styleId?: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  paragraphs: DesignParagraph[];
}

export interface DesignShape {
  kind: "shape";
  styleId?: string;
  shapeType: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  text?: string;
  points?: string;
  fillImage?: DesignImageFill;
}

export type DesignPageItem = DesignTextFrame | DesignShape;

export interface DesignPage {
  id: string;
  name: string;
  widthPt: number;
  heightPt: number;
  items: DesignPageItem[];
}

export interface DesignDocument {
  sourcePath: string;
  pageWidthPt: number;
  pageHeightPt: number;
  pages: DesignPage[];
  paragraphStyles: DesignParagraphStyle[];
  characterStyles: DesignCharacterStyle[];
  graphicStyles: DesignGraphicStyle[];
  imageFills: DesignImageFill[];
}
