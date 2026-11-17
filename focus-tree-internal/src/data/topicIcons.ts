export interface TopicIcon {
  key: string;
  zh: string;
  en: string;
  file: string;
  nodeIds: string[];
  note?: string;
}

/**
 * 圖標與節點屬展示層對應，不改動定稿資料。
 * nodeIds 為空者代表圖標沒有官方對應節點，UI 顯示「待綁定」。
 */
export const TOPIC_ICONS: TopicIcon[] = [
  {
    key: 'foundations',
    zh: '化學基礎概念',
    en: 'Chemical Foundations',
    file: '01-foundations.png',
    nodeIds: [],
    note: '入門總覽，無單一官方課題對應',
  },
  { key: 'planet-earth', zh: '地球行星', en: 'Planet Earth', file: '02-planet-earth.png', nodeIds: ['CHEM-P1-T01'] },
  { key: 'micro-world-1', zh: '微觀世界 I', en: 'Microscopic World I', file: '03-micro-world-1.png', nodeIds: ['CHEM-P1-T02'] },
  { key: 'metals', zh: '金屬', en: 'Metals', file: '04-metals.png', nodeIds: ['CHEM-P1-T03'] },
  { key: 'acids-bases', zh: '酸與鹼', en: 'Acids and Bases', file: '05-acids-bases.png', nodeIds: ['CHEM-P1-T04'] },
  {
    key: 'fossil-fuels',
    zh: '化石燃料與碳化合物',
    en: 'Fossil Fuels and Carbon Compounds',
    file: '06-fossil-fuels.png',
    nodeIds: ['CHEM-P1-T05'],
  },
  { key: 'micro-world-2', zh: '微觀世界 II', en: 'Microscopic World II', file: '07-micro-world-2.png', nodeIds: ['CHEM-P1-T06'] },
  {
    key: 'redox-electrolysis',
    zh: '氧化還原、化學電池與電解',
    en: 'Redox, Chemical Cells and Electrolysis',
    file: '08-redox-electrolysis.png',
    nodeIds: ['CHEM-P1-T07'],
  },
  {
    key: 'reaction-energy-equilibrium',
    zh: '化學反應與能量／化學平衡',
    en: 'Chemical Reactions, Energy and Equilibrium',
    file: '09-reaction-energy-equilibrium.png',
    nodeIds: ['CHEM-P1-T08', 'CHEM-P1-T10'],
  },
  {
    key: 'quantitative-analysis',
    zh: '計量分析基礎',
    en: 'Quantitative Analysis Foundations',
    file: '10-quantitative-analysis.png',
    nodeIds: [],
    note: '定稿無獨立「計量分析」節點',
  },
  {
    key: 'enthalpy-hess',
    zh: '焓變與赫斯定律',
    en: "Enthalpy Change and Hess's Law",
    file: '11-enthalpy-hess.png',
    nodeIds: ['CHEM-P1-T08'],
  },
  {
    key: 'equilibrium-constant',
    zh: '平衡常數計算',
    en: 'Equilibrium Constant Calculations',
    file: '12-equilibrium-constant.png',
    nodeIds: ['CHEM-P1-T10'],
  },
  { key: 'industrial', zh: '工業化學', en: 'Industrial Chemistry', file: '13-industrial-chemistry.png', nodeIds: ['CHEM-P2-E01'] },
  { key: 'materials', zh: '材料化學', en: 'Materials Chemistry', file: '14-materials-chemistry.png', nodeIds: ['CHEM-P2-E02'] },
  { key: 'analytical', zh: '分析化學', en: 'Analytical Chemistry', file: '15-analytical-chemistry.png', nodeIds: ['CHEM-P2-E03'] },
  { key: 'paper2-sprint', zh: '化學卷二衝刺', en: 'Paper 2 Sprint', file: '16-paper2-sprint.png', nodeIds: ['CHEM-P2'] },
  {
    key: 'practical-intensive',
    zh: '化學實驗題強化',
    en: 'Practical Question Intensive',
    file: '17-practical-intensive.png',
    nodeIds: ['CHEM-SBA-01'],
  },
  { key: 'elective-integration', zh: '選修單元整合', en: 'Elective Integration', file: '18-elective-integration.png', nodeIds: ['CHEM-P2'] },
];
