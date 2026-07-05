export const config = {
  port: parseInt(process.env.PORT || "3456", 10),
  sessionTTL: 5 * 60 * 1000, // 5 min inactivity before cleanup
  cleanupInterval: 30 * 1000, // check every 30s
};
