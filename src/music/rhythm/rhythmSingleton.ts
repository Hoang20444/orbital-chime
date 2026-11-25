import { synthEngine } from "../../audio/synthEngine.ts";
import { RhythmEngine } from "./RhythmEngine.ts";

export const rhythmEngine = new RhythmEngine(synthEngine.manager);
