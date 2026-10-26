// CI runs in UTC and phones don't, so pin the zone for date tests
module.exports = () => {
  process.env.TZ = "UTC";
};
