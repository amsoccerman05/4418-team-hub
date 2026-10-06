/** Minimal ZIP STORE writer: UTF-8 filenames, CRC32, no compression, no external dependencies. */
export type ZipEntry={name:string;data:Uint8Array};
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(data:Uint8Array){let c=0xffffffff;for(const byte of data)c=CRC_TABLE[(c^byte)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
export function storeZip(entries:ZipEntry[]):Uint8Array {
 if(entries.length>65535)throw new Error('Too many presentation parts.');
 const names=new Set<string>(),encoder=new TextEncoder(),records:Uint8Array[]=[],directory:Uint8Array[]=[];let offset=0;
 for(const entry of entries){
  if(names.has(entry.name)||entry.name.startsWith('/')||entry.name.split('/').includes('..'))throw new Error('Invalid presentation part.');names.add(entry.name);
  const name=encoder.encode(entry.name),data=entry.data,crc=crc32(data),local=new Uint8Array(30+name.length),l=new DataView(local.buffer);
  if(name.length>65535||data.length>0xffffffff)throw new Error('Presentation part too large.');
  l.setUint32(0,0x04034b50,true);l.setUint16(4,20,true);l.setUint16(6,0x0800,true);l.setUint16(12,33,true);l.setUint32(14,crc,true);l.setUint32(18,data.length,true);l.setUint32(22,data.length,true);l.setUint16(26,name.length,true);local.set(name,30);
  records.push(local,data);
  const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);
  c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);directory.push(central);offset+=local.length+data.length;
 }
 const directorySize=directory.reduce((n,d)=>n+d.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);
 if(offset+directorySize>0xffffffff)throw new Error('Presentation exceeds ZIP size limit.');
 e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,directorySize,true);e.setUint32(16,offset,true);
 const output=new Uint8Array(offset+directorySize+22);let cursor=0;for(const chunk of [...records,...directory,end]){output.set(chunk,cursor);cursor+=chunk.length;}return output;
}
