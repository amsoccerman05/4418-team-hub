import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownedMealsDatabaseAddress } from './meals-network.mjs';
const project='fabrication-it-1234abcd-567', networkId='a'.repeat(64), containerId='b'.repeat(64);
function fixture(address='172.19.0.2') {
  const name=`supabase_db_${project}`, networkName=`${project}-loopback`;
  return { containers:[{Id:containerId,Name:`/${name}`,State:{Running:true},NetworkSettings:{Networks:{[networkName]:{NetworkID:networkId,IPAddress:address}}}}],
    network:{Id:networkId,Name:networkName,Labels:{'fabrication.integration':project},Containers:{[containerId]:{Name:name,IPv4Address:`${address}/16`}}} };
}
test('owned database address comes from matching running container and network inspections',()=>{
  for(const address of ['10.1.2.3','172.16.0.2','172.31.255.3','192.168.1.2']) {
    const f=fixture(address);assert.equal(ownedMealsDatabaseAddress(f.containers,f.network,project),address);
  }
});
test('public, loopback, link-local, malformed and mismatched addresses are rejected',()=>{
  for(const address of ['8.8.8.8','127.0.0.1','169.254.1.1','172.15.0.1','172.32.0.1','192.169.1.1','10.01.2.3','10.999.0.1','::1','meals-db']) {
    const f=fixture(address);assert.throws(()=>ownedMealsDatabaseAddress(f.containers,f.network,project));
  }
  const f=fixture();f.network.Containers[containerId].IPv4Address='172.19.0.3/16';assert.throws(()=>ownedMealsDatabaseAddress(f.containers,f.network,project),/disagree/);
});
test('unowned network, wrong container, stopped container and wrong membership are rejected',()=>{
  const edits=[
    f=>{f.network.Labels['fabrication.integration']='another-run';},
    f=>{f.network.Name='unrelated-network';},
    f=>{f.containers[0].Name='/supabase_db_another';},
    f=>{f.containers[0].State.Running=false;},
    f=>{f.containers[0].NetworkSettings.Networks[f.network.Name].NetworkID='c'.repeat(64);},
    f=>{delete f.network.Containers[containerId];},
  ];
  for(const edit of edits){const f=fixture();edit(f);assert.throws(()=>ownedMealsDatabaseAddress(f.containers,f.network,project));}
});
