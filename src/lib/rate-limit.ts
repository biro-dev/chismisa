import { checkRateLimit as checkRateLimitImpl } from "@/lib/rate-limit-redis";

export const checkRateLimit = checkRateLimitImpl;