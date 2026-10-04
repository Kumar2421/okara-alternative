import { FEATURES } from "@/lib/features";

/**
 * Where OAuth connections (Gmail, GitHub, Google) land after connect or error.
 *
 * Self-host manages its own keys on API Credentials. Platform mode hides that
 * page (it manages keys itself), so a redirect there strands hosted users on a
 * page that is not in the nav. Hosted users connect everything from
 * Integrations instead.
 */
export const CREDENTIALS_PATH = FEATURES.PLATFORM_MODE ? "/settings/integrations" : "/settings/api-credentials";
