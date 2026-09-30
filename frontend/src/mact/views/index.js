import Dashboard from "./Dashboard";
import Sync from "./Sync";
import Cases from "./Cases";
import Diary from "./Diary";
import Case from "./Case";
import Settle from "./Settle";
import Awards from "./Awards";
import Recovery from "./Recovery";
import Integrity from "./Integrity";
import Ask from "./Ask";
import Mis from "./Mis";
import Workflow from "./Workflow";
import Rules from "./Rules";
import Dev from "./Dev";
import LokAdalat from "./LokAdalat";

// Add each newly ported view here. Anything missing falls back to <Placeholder />.
export const VIEWS = {
  dashboard: Dashboard,
  sync: Sync,
  cases: Cases,
  diary: Diary,
  case: Case,
  settle: Settle,
  awards: Awards,
  recovery: Recovery,
  integrity: Integrity,
  ask: Ask,
  mis: Mis,
  workflow: Workflow,
  rules: Rules,
  dev: Dev,
  lokadalat: LokAdalat,
  
};