import type { vendorRole, vendorUserStatus } from "../schema/enums.js";
import type { vendorUsers } from "../schema/vendor.js";

export type VendorRole = (typeof vendorRole.enumValues)[number];

export type VendorUserStatus = (typeof vendorUserStatus.enumValues)[number];

export type VendorUser = typeof vendorUsers.$inferSelect;
