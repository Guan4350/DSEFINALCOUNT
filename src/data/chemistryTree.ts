export type FocusCategory = 'root' | 'module' | 'topic' | 'elective' | 'sba';

export interface PublicFocusNode {
  id: string;
  title: string;
  prerequisites: string[];
  weight: number | null;
  category: FocusCategory;
  icon: string;
}

/** 由 chem_focus_tree.final.json 投影：只取學生可見節點，排除 CHEM-MS*。 */
export const FOCUS_NODES: PublicFocusNode[] = [
  {
    "id": "CHEM-ROOT",
    "title": "DSE Chemistry 達 5** 總目標",
    "prerequisites": [
      "CHEM-P1",
      "CHEM-P2",
      "CHEM-SBA"
    ],
    "weight": 100,
    "category": "root",
    "icon": ""
  },
  {
    "id": "CHEM-P1",
    "title": "Paper 1 必修部分",
    "prerequisites": [],
    "weight": 60,
    "category": "module",
    "icon": ""
  },
  {
    "id": "CHEM-P2",
    "title": "Paper 2 選修部分",
    "prerequisites": [],
    "weight": 20,
    "category": "module",
    "icon": ""
  },
  {
    "id": "CHEM-P1-T01",
    "title": "Topic I Planet Earth",
    "prerequisites": [],
    "weight": null,
    "category": "topic",
    "icon": "02-planet-earth.png"
  },
  {
    "id": "CHEM-P1-T02",
    "title": "Topic II Microscopic World I",
    "prerequisites": [],
    "weight": null,
    "category": "topic",
    "icon": "03-micro-world-1.png"
  },
  {
    "id": "CHEM-P1-T03",
    "title": "Topic III Metals",
    "prerequisites": [],
    "weight": null,
    "category": "topic",
    "icon": "04-metals.png"
  },
  {
    "id": "CHEM-P1-T04",
    "title": "Topic IV Acids and Bases",
    "prerequisites": [
      "CHEM-P1-T03"
    ],
    "weight": null,
    "category": "topic",
    "icon": "05-acids-bases.png"
  },
  {
    "id": "CHEM-P1-T05",
    "title": "Topic V Fossil Fuels and Carbon Compounds",
    "prerequisites": [],
    "weight": null,
    "category": "topic",
    "icon": "06-fossil-fuels.png"
  },
  {
    "id": "CHEM-P1-T06",
    "title": "Topic VI Microscopic World II",
    "prerequisites": [
      "CHEM-P1-T02"
    ],
    "weight": null,
    "category": "topic",
    "icon": "07-micro-world-2.png"
  },
  {
    "id": "CHEM-P1-T07",
    "title": "Topic VII Redox Reactions, Chemical Cells and Electrolysis",
    "prerequisites": [],
    "weight": null,
    "category": "topic",
    "icon": "08-redox-electrolysis.png"
  },
  {
    "id": "CHEM-P1-T08",
    "title": "Topic VIII Chemical Reactions and Energy",
    "prerequisites": [],
    "weight": null,
    "category": "topic",
    "icon": "09-reaction-energy-equilibrium.png"
  },
  {
    "id": "CHEM-P1-T09",
    "title": "Topic IX Rate of Reaction",
    "prerequisites": [],
    "weight": null,
    "category": "topic",
    "icon": ""
  },
  {
    "id": "CHEM-P1-T10",
    "title": "Topic X Chemical Equilibrium",
    "prerequisites": [],
    "weight": null,
    "category": "topic",
    "icon": "12-equilibrium-constant.png"
  },
  {
    "id": "CHEM-P1-T11",
    "title": "Topic XI Chemistry of Carbon Compounds",
    "prerequisites": [
      "CHEM-P1-T05",
      "CHEM-P1-T06"
    ],
    "weight": null,
    "category": "topic",
    "icon": ""
  },
  {
    "id": "CHEM-P1-T12",
    "title": "Topic XII Patterns in the Chemical World",
    "prerequisites": [],
    "weight": null,
    "category": "topic",
    "icon": ""
  },
  {
    "id": "CHEM-P2-E01",
    "title": "Topic XIII Industrial Chemistry",
    "prerequisites": [
      "CHEM-P1-T09",
      "CHEM-P1-T10"
    ],
    "weight": null,
    "category": "elective",
    "icon": "13-industrial-chemistry.png"
  },
  {
    "id": "CHEM-P2-E02",
    "title": "Topic XIV Materials Chemistry",
    "prerequisites": [],
    "weight": null,
    "category": "elective",
    "icon": "14-materials-chemistry.png"
  },
  {
    "id": "CHEM-P2-E03",
    "title": "Topic XV Analytical Chemistry",
    "prerequisites": [
      "CHEM-P1-T04"
    ],
    "weight": null,
    "category": "elective",
    "icon": "15-analytical-chemistry.png"
  },
  {
    "id": "CHEM-SBA",
    "title": "SBA 校本評核",
    "prerequisites": [],
    "weight": 20,
    "category": "module",
    "icon": ""
  },
  {
    "id": "CHEM-SBA-01",
    "title": "實驗技能與探究",
    "prerequisites": [],
    "weight": null,
    "category": "sba",
    "icon": ""
  }
];
