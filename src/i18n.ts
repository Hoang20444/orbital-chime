export type Locale = "en" | "vi";

export type Strings = {
  appName: string;
  puzzleMode: string;
  sandboxMode: string;
  trackLabel: string;
  presetLabel: string;
  play: string;
  pause: string;
  hint: string;
  hideHint: string;
  shareLink: string;
  copied: string;
  undo: string;
  redo: string;
  clear: string;
  reset: string;
  mute: string;
  unmute: string;
  deleteSelected: string;
  nextTrack: string;
  keepListening: string;
  trackComplete: string;
  dragTip: string;
  groups: {
    instruments: string;
    physics: string;
    studio: string;
  };
  tools: {
    marimba: string;
    brass: string;
    ceramic: string;
    bass: string;
    bumper: string;
    splitter: string;
    tube: string;
    emitter: string;
  };
  tooltips: {
    play: string;
    marimba: string;
    brass: string;
    ceramic: string;
    bass: string;
    bumper: string;
    splitter: string;
    tube: string;
    emitter: string;
    undo: string;
    redo: string;
    hint: string;
    share: string;
    reset: string;
    clear: string;
    remove: string;
  };
  scales: {
    c_pentatonic: string;
    f_lydian: string;
    d_hirajoshi: string;
    a_minor9: string;
    g_dorian: string;
  };
};

export const I18N: Record<Locale, Strings> = {
  en: {
    appName: "Orbital Chime",
    puzzleMode: "Puzzle Album",
    sandboxMode: "Sandbox",
    trackLabel: "Track",
    presetLabel: "Preset",
    play: "Play",
    pause: "Pause",
    hint: "Hint",
    hideHint: "Hide",
    shareLink: "Share",
    copied: "Copied!",
    undo: "Undo",
    redo: "Redo",
    clear: "Clear",
    reset: "Reset",
    mute: "Muted",
    unmute: "Sound",
    deleteSelected: "Remove",
    nextTrack: "Next track",
    keepListening: "Keep listening",
    trackComplete: "Harmony complete",
    dragTip:
      "Drag on canvas to draw a bar · Drag ends to tune & aim · Right-click removes",
    groups: {
      instruments: "Instruments",
      physics: "Physics",
      studio: "Studio",
    },
    tools: {
      marimba: "Maple",
      brass: "Brass",
      ceramic: "Ceramic",
      bass: "Bass",
      bumper: "Bumper",
      splitter: "Prism",
      tube: "Tube",
      emitter: "Emitter",
    },
    tooltips: {
      play: "Start or pause simulation [Space]",
      marimba: "Maple wood bar · Warm tone [1]",
      brass: "Brushed brass rod · High bounce [2]",
      ceramic: "Celadon bell · Clear chime [3]",
      bass: "Slate metal slab · Deep bass [4]",
      bumper: "Elastic bumper · Lifts marbles upward",
      splitter: "Prism splitter · Divides 1 marble into 2",
      tube: "Glass tube · Drag to draw a curved marble guide",
      emitter: "Beat emitter · Drops marbles on rhythm",
      undo: "Undo last change [Ctrl+Z]",
      redo: "Redo undone change [Ctrl+Y]",
      hint: "Show dashed placement guide [H]",
      share: "Copy shareable studio link",
      reset: "Reset track pieces [R]",
      clear: "Clear studio workspace [R]",
      remove: "Remove selected piece [Del]",
    },
    scales: {
      c_pentatonic: "C Penta",
      f_lydian: "F Lydian",
      d_hirajoshi: "D Hirajoshi",
      a_minor9: "A Min 9",
      g_dorian: "G Dorian",
    },
  },
  vi: {
    appName: "Orbital Chime",
    puzzleMode: "Album 12 Màn",
    sandboxMode: "Tự do",
    trackLabel: "Màn",
    presetLabel: "Mẫu",
    play: "Chạy",
    pause: "Dừng",
    hint: "Gợi ý",
    hideHint: "Ẩn",
    shareLink: "Chia sẻ",
    copied: "Đã chép!",
    undo: "Hoàn tác",
    redo: "Làm lại",
    clear: "Xóa hết",
    reset: "Đặt lại",
    mute: "Tắt tiếng",
    unmute: "Âm thanh",
    deleteSelected: "Xóa",
    nextTrack: "Màn tiếp",
    keepListening: "Nghe tiếp",
    trackComplete: "Cộng hưởng hoàn hảo",
    dragTip:
      "Kéo trên giấy để vẽ thanh nhạc · Kéo hai đầu để chỉnh nốt & góc · Chuột phải để xóa",
    groups: {
      instruments: "Nhạc cụ",
      physics: "Vật lý",
      studio: "Điều khiển",
    },
    tools: {
      marimba: "Gỗ",
      brass: "Đồng",
      ceramic: "Gốm",
      bass: "Trầm",
      bumper: "Đệm nảy",
      splitter: "Chia tia",
      tube: "Ống dẫn",
      emitter: "Nguồn bi",
    },
    tooltips: {
      play: "Chạy hoặc dừng mô phỏng [Space]",
      marimba: "Thanh gỗ phong · Âm mộc ấm áp [1]",
      brass: "Thanh đồng phay · Nảy xa, ngân dài [2]",
      ceramic: "Thanh gốm men · Âm chuông trong trẻo [3]",
      bass: "Thanh kim loại trầm · Giữ nhịp nền [4]",
      bumper: "Đệm đàn hồi · Bật bi vọt lên cao",
      splitter: "Lăng kính · Tách 1 bi thành 2 nhánh",
      tube: "Ống thủy tinh cong · Kéo để dẫn bóng chảy xuống thanh tiếp theo",
      emitter: "Nguồn thả bi theo nhịp BPM",
      undo: "Hoàn tác bước vừa làm [Ctrl+Z]",
      redo: "Khôi phục bước vừa hoàn tác [Ctrl+Y]",
      hint: "Hiện khung gợi ý đặt thanh [H]",
      share: "Chép liên kết chia sẻ cỗ máy",
      reset: "Đặt lại màn chơi [R]",
      clear: "Dọn trống bàn chơi [R]",
      remove: "Xóa vật thể đang chọn [Del]",
    },
    scales: {
      c_pentatonic: "Đô Ngũ cung",
      f_lydian: "Fa Lydian",
      d_hirajoshi: "Rê Hirajoshi",
      a_minor9: "La Thứ 9",
      g_dorian: "Sol Dorian",
    },
  },
};
