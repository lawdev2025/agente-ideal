import { getDatabase } from "../db/connection";
import { StateRepository } from "./repository";

export function createStateDb(): StateRepository {
  return new StateRepository();
}

export { StateRepository };
