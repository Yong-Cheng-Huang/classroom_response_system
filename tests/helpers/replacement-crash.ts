import { writeSync } from 'node:fs';
import { openDatabase } from '../../src/server/database.js';
import { replacePreparedActivity } from '../../src/server/activity-replacement.js';
import { preparedActivity } from './replacement.js';

const database=openDatabase(process.argv[2]!);
const boundary=process.argv[3];
function halt(marker:string): never {writeSync(1,marker+'\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);throw new Error('未預期恢復');}
if(boundary==='before') {
  database.function('test_replacement_halt',()=>halt('BEFORE_COMMIT'));
  database.exec(`CREATE TRIGGER test_halt BEFORE INSERT ON question_fields WHEN NEW.prompt='新子題二'
    BEGIN SELECT test_replacement_halt(); END;`);
}
await replacePreparedActivity(database,preparedActivity(),{activityId:'a',version:1,confirmed:true},
  boundary==='after'?()=>halt('AFTER_COMMIT'):undefined);
database.close();
