import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
for(const dir of ['src','public','scripts'])for(const name of fs.readdirSync(dir).filter(x=>/\.(js|mjs)$/.test(x))){
 const result=spawnSync(process.execPath,['--check',dir+'/'+name],{stdio:'inherit'});if(result.status)process.exit(result.status);
}
const result=spawnSync(process.execPath,['--test','tests/security.test.js','tests/workflow.test.js'],{stdio:'inherit'});process.exit(result.status || 0);
