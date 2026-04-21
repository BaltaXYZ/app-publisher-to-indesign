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
  fontWeight?: string;
  fontStyle?: string;
  color?: DesignColor;
}

export interface DesignParagraph {
  styleId?: string;
  runs: DesignTextRun[];
}

export interface DesignTextFrame {
  kind: "textFrame";
  id: string;
  role?:
    | "story"
    | "article"
    | "cover-title"
    | "cover-abstract"
    | "issue-label"
    | "caption"
    | "table"
    | "reference"
    | "footer"
    | "back-matter"
    | "layout-placeholder";
  styleId?: string;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  columnCount?: number;
  columnGapPt?: number;
  storyId?: string;
  paragraphs?: DesignParagraph[];
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
  textWrap?: "bounding-box";
}

export type DesignPageItem = DesignTextFrame | DesignShape;

export interface DesignPage {
  id: string;
  name: string;
  widthPt: number;
  heightPt: number;
  items: DesignPageItem[];
}

export interface DesignTextStory {
  id: string;
  fingerprint: string;
  paragraphs: DesignParagraph[];
  sourceMalformedSingleCharacterParagraphsDetected?: boolean;
  malformedSingleCharacterParagraphsDetected?: boolean;
  singleCharacterParagraphCount?: number;
  canonicalTextCoverage?: number;
}

export interface PageLayoutAnalysis {
  pageId: string;
  pageNumber: number;
  textFrameCount: number;
  columnCount: number;
  columnBands: Array<{ leftPt: number; rightPt: number }>;
  pageTextFingerprint: string;
}

export interface DesignDocument {
  sourcePath: string;
  pageWidthPt: number;
  pageHeightPt: number;
  pages: DesignPage[];
  textStories: DesignTextStory[];
  layoutAnalysis: PageLayoutAnalysis[];
  paragraphStyles: DesignParagraphStyle[];
  characterStyles: DesignCharacterStyle[];
  graphicStyles: DesignGraphicStyle[];
  imageFills: DesignImageFill[];
  diagnostics?: {
    sourceMalformedSingleCharacterParagraphsDetected: boolean;
    malformedSingleCharacterParagraphsDetected: boolean;
    singleCharacterParagraphCount: number;
    canonicalTextCoverage: number;
    canonicalParagraphCount: number;
    storyParagraphCount: number;
    footerTextFrames: number;
    firstStoryFrameColumnCount?: number;
    mainFlowColumnCounts: number[];
    coverTitlePresent: boolean;
    coverAbstractPresent: boolean;
    articleStartsAfterCoverPassed: boolean;
    footerPageAndUrlPresent: boolean;
    repeatedFooterTextInStoryDetected: boolean;
    misplacedBackMatterDetected: boolean;
    textWrapPassed: boolean;
    textWrapShapeCount: number;
    pageLandmarkMatches?: boolean[];
    sectionPageMatches?: boolean;
    captionPresencePassed?: boolean;
    tablePresencePassed?: boolean;
    referenceAlignmentPassed?: boolean;
    backMatterZonesPassed?: boolean;
    referenceAnchoredLayoutApplied?: boolean;
  };
}
