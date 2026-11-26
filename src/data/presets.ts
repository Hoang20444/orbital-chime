import type { PresetDef } from "../engine/types.ts";

export const SANDBOX_PRESETS: PresetDef[] = [
  {
    id: "morning-chime",
    nameEn: "Morning Chime",
    nameVi: "Chuông Sớm Mai",
    bpm: 102,
    scaleId: "c_pentatonic",
    emitters: [
      { id: "e1", x: 240, y: 95, vx: 40, vy: 0, beatInterval: 2, phaseOffset: 0 },
      { id: "e2", x: 760, y: 95, vx: -40, vy: 0, beatInterval: 3, phaseOffset: 1 },
    ],
    bars: [
      { id: "b1", ax: 215, ay: 270, bx: 345, by: 305, material: "marimba" },
      { id: "b2", ax: 655, ay: 305, bx: 785, by: 270, material: "ceramic" },
      { id: "b3", ax: 410, ay: 425, bx: 590, by: 400, material: "brass" },
      { id: "b4", ax: 220, ay: 550, bx: 450, by: 530, material: "bass" },
      { id: "b5", ax: 550, ay: 530, bx: 780, by: 550, material: "marimba" },
    ],
    bumpers: [{ id: "bmp1", x: 500, y: 575, radius: 22 }],
    splitters: [{ id: "spl1", x: 500, y: 245, radius: 20 }],
  },
  {
    id: "prism-duet",
    nameEn: "Prism Duet",
    nameVi: "Song Tấu Lăng Kính",
    bpm: 112,
    scaleId: "f_lydian",
    emitters: [
      { id: "e1", x: 500, y: 85, vx: 0, vy: 0, beatInterval: 2, phaseOffset: 0 },
    ],
    bars: [
      { id: "b1", ax: 245, ay: 335, bx: 375, by: 365, material: "ceramic" },
      { id: "b2", ax: 625, ay: 365, bx: 755, by: 335, material: "brass" },
      { id: "b3", ax: 315, ay: 525, bx: 475, by: 495, material: "marimba" },
      { id: "b4", ax: 525, ay: 495, bx: 685, by: 525, material: "bass" },
      { id: "b5", ax: 130, ay: 465, bx: 245, by: 515, material: "marimba" },
      { id: "b6", ax: 755, ay: 515, bx: 870, by: 465, material: "ceramic" },
    ],
    bumpers: [],
    splitters: [
      { id: "spl1", x: 500, y: 205, radius: 20 },
      { id: "spl2", x: 350, y: 385, radius: 20 },
      { id: "spl3", x: 650, y: 385, radius: 20 },
    ],
  },
  {
    id: "perpetual-fountain",
    nameEn: "Perpetual Fountain",
    nameVi: "Đài Phun Nhịp Điệu",
    bpm: 108,
    scaleId: "a_minor9",
    emitters: [
      { id: "e1", x: 360, y: 95, vx: 55, vy: 0, beatInterval: 1.5, phaseOffset: 0 },
      { id: "e2", x: 640, y: 95, vx: -55, vy: 0, beatInterval: 2, phaseOffset: 0.75 },
    ],
    bars: [
      { id: "b1", ax: 280, ay: 300, bx: 390, by: 325, material: "brass" },
      { id: "b2", ax: 610, ay: 325, bx: 720, by: 300, material: "ceramic" },
      { id: "b3", ax: 185, ay: 470, bx: 340, by: 515, material: "bass" },
      { id: "b4", ax: 660, ay: 515, bx: 815, by: 470, material: "bass" },
      { id: "b5", ax: 430, ay: 555, bx: 570, by: 555, material: "marimba" },
    ],
    bumpers: [
      { id: "bmp1", x: 500, y: 410, radius: 22 },
      { id: "bmp2", x: 365, y: 585, radius: 22 },
      { id: "bmp3", x: 635, y: 585, radius: 22 },
    ],
    splitters: [],
  },
  {
    id: "v-rail-transfer",
    nameEn: "V-Rail Transfer",
    nameVi: "Cầu dẫn V-Rail",
    bpm: 100,
    scaleId: "a_minor9",
    emitters: [
      { id: "e1", x: 276, y: 88, vx: 12, vy: 0, beatInterval: 2.5, phaseOffset: 0 },
    ],
    rails: [
      {
        id: "rail1",
        variant: "v",
        x: 372,
        y: 325,
        rotation: 0.14,
        armLength: 148,
        openingAngle: 86,
        curvature: 0.58,
        slopeBias: 0.1,
        channelWidth: 26,
        boost: 0.25,
      },
    ],
    bars: [
      { id: "b1", ax: 680, ay: 338, bx: 795, by: 312, material: "marimba" },
      { id: "b2", ax: 865, ay: 345, bx: 995, by: 305, material: "ceramic" },
      { id: "b3", ax: 675, ay: 470, bx: 815, by: 485, material: "brass" },
    ],
    bumpers: [],
    splitters: [],
  },
];
