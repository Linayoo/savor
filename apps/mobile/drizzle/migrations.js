import journal from './meta/_journal.json';
import m0000 from './0000_init.sql';
import m0001 from './0001_moment_pending.sql';
import m0002 from './0002_photo_sync.sql';
import m0003 from './0003_letters.sql';
import m0004 from './0004_scrub_tombstones.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004
    }
  }
  