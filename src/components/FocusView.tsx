import { useMemo, useState } from 'react';
import { Modal } from './Modal';

type FocusGroup = 'compulsory' | 'elective' | 'sprint';

interface FocusTopic {
  key: string;
  zh: string;
  en: string;
  file: string;
  group: FocusGroup;
}

const TOPICS: FocusTopic[] = [
  { key: 'foundations', zh: '化學基礎概念', en: 'Chemical Foundations', file: '01-foundations.png', group: 'compulsory' },
  { key: 'planet-earth', zh: '地球行星', en: 'Planet Earth', file: '02-planet-earth.png', group: 'compulsory' },
  { key: 'micro-world-1', zh: '微觀世界 I', en: 'Microscopic World I', file: '03-micro-world-1.png', group: 'compulsory' },
  { key: 'metals', zh: '金屬', en: 'Metals', file: '04-metals.png', group: 'compulsory' },
  { key: 'acids-bases', zh: '酸與鹼', en: 'Acids and Bases', file: '05-acids-bases.png', group: 'compulsory' },
  { key: 'fossil-fuels', zh: '化石燃料與碳化合物', en: 'Fossil Fuels and Carbon Compounds', file: '06-fossil-fuels.png', group: 'compulsory' },
  { key: 'micro-world-2', zh: '微觀世界 II', en: 'Microscopic World II', file: '07-micro-world-2.png', group: 'compulsory' },
  { key: 'redox-electrolysis', zh: '氧化還原、化學電池與電解', en: 'Redox, Chemical Cells and Electrolysis', file: '08-redox-electrolysis.png', group: 'compulsory' },
  { key: 'reaction-energy', zh: '化學反應與能量／化學平衡', en: 'Chemical Reactions, Energy and Equilibrium', file: '09-reaction-energy-equilibrium.png', group: 'compulsory' },
  { key: 'quantitative-analysis', zh: '計量分析基礎', en: 'Quantitative Analysis Foundations', file: '10-quantitative-analysis.png', group: 'compulsory' },
  { key: 'enthalpy-hess', zh: '焓變與赫斯定律', en: "Enthalpy Change and Hess's Law", file: '11-enthalpy-hess.png', group: 'compulsory' },
  { key: 'equilibrium-constant', zh: '平衡常數計算', en: 'Equilibrium Constant Calculations', file: '12-equilibrium-constant.png', group: 'compulsory' },
  { key: 'industrial', zh: '工業化學', en: 'Industrial Chemistry', file: '13-industrial-chemistry.png', group: 'elective' },
  { key: 'materials', zh: '材料化學', en: 'Materials Chemistry', file: '14-materials-chemistry.png', group: 'elective' },
  { key: 'analytical', zh: '分析化學', en: 'Analytical Chemistry', file: '15-analytical-chemistry.png', group: 'elective' },
  { key: 'paper2-sprint', zh: '化學卷二衝刺', en: 'Paper 2 Sprint', file: '16-paper2-sprint.png', group: 'sprint' },
  { key: 'practical-intensive', zh: '化學實驗題強化', en: 'Practical Question Intensive', file: '17-practical-intensive.png', group: 'sprint' },
  { key: 'elective-integration', zh: '選修單元整合', en: 'Elective Integration', file: '18-elective-integration.png', group: 'sprint' },
];

const GROUP_LABEL: Record<FocusGroup, string> = {
  compulsory: '必修',
  elective: '選修',
  sprint: '衝刺與整合',
};

type Filter = 'all' | FocusGroup;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '全部 18' },
  { value: 'compulsory', label: '必修 12' },
  { value: 'elective', label: '選修 3' },
  { value: 'sprint', label: '衝刺 3' },
];

export function FocusView() {
  const [filter, setFilter] = useState<Filter>('all');
  const [active, setActive] = useState<FocusTopic | null>(null);
  const base = import.meta.env.BASE_URL;

  const topics = useMemo(
    () => (filter === 'all' ? TOPICS : TOPICS.filter(topic => topic.group === filter)),
    [filter],
  );

  return (
    <div className="page focus-page">
      <header className="page-head">
        <div>
          <div className="eyebrow">Chemistry / National Focus</div>
          <h1 className="page-title">國策</h1>
          <p className="page-subtitle">
            18 個 Chemistry 課題圖標，中英對照。作為溫習索引，不改變任何課程前置、權重或評分標準。
          </p>
        </div>
        <div className="focus-filters" role="group" aria-label="篩選課題">
          {FILTERS.map(item => (
            <button
              key={item.value}
              type="button"
              className={`focus-filter${filter === item.value ? ' active' : ''}`}
              onClick={() => setFilter(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <div className="focus-grid">
        {topics.map(topic => (
          <button
            key={topic.key}
            type="button"
            className="focus-card"
            onClick={() => setActive(topic)}
          >
            <span className="focus-thumb">
              <img src={`${base}icons/topics/${topic.file}`} alt="" loading="lazy" />
            </span>
            <span className="focus-name">
              <strong>{topic.zh}</strong>
              <em>{topic.en}</em>
            </span>
            <span className={`focus-tag ${topic.group}`}>{GROUP_LABEL[topic.group]}</span>
          </button>
        ))}
      </div>

      <p className="focus-note">
        圖標只作視覺索引；完整的節點進度、前置解鎖與內部評分證據，在內部國策樹版本維護，不在此公開頁面載入。
      </p>

      {active ? (
        <Modal
          title={active.zh}
          eyebrow={active.en}
          onClose={() => setActive(null)}
          footer={
            <button type="button" className="btn btn-sm" onClick={() => setActive(null)}>
              關閉
            </button>
          }
        >
          <div className="focus-modal">
            <img src={`${base}icons/topics/${active.file}`} alt="" />
            <div>
              <span className={`focus-tag ${active.group}`}>{GROUP_LABEL[active.group]}</span>
              <p>
                Chemistry {GROUP_LABEL[active.group]}課題圖標。此頁只提供中英對照與視覺索引，不代表官方課程單元編號或學習次序。
              </p>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
