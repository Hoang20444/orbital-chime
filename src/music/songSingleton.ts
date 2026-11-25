import { synthEngine } from "../audio/synthEngine.ts";
import { SongDirector } from "./SongDirector.ts";

export const songDirector = new SongDirector(synthEngine.manager);
