// Moved to src/lib/domain.ts so the server read layer and client components
// can import domain constants without touching the actions layer. This
// re-export keeps existing `actions/_constants` imports working.
export {
  ACTOR,
  ASSET_TYPES,
  ACCOUNT_TYPES,
  CASH_BEARING_ACCOUNT_TYPES,
  isCashBearingAccount,
} from "../lib/domain";
export type { ActionError, ActionResult, AssetType, AccountType } from "../lib/domain";
