/** Two-column paste only: names and emails. Role/access choices stay in the review UI. */
export function parseInvitationList(text:string):{recipients:{display_name:string;email:string}[];errors:string[]}{
 const recipients:{display_name:string;email:string}[]=[],errors:string[]=[];
 for(const [index,raw] of text.split(/\r?\n/).entries()){
  const line=raw.trim();if(!line)continue;
  let fields:string[]=[];
  if(line.includes('\t'))fields=line.split('\t').map(value=>value.trim());
  else{
   let value='',quoted=false;
   for(let i=0;i<line.length;i++){
    const char=line[i];
    if(char==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(char===','&&!quoted){fields.push(value.trim());value='';}
    else value+=char;
   }
   if(quoted){errors.push(`Line ${index+1}: close the quotation mark around the name.`);continue;}
   fields.push(value.trim());
  }
  if(index===0&&['name','display name'].includes(fields[0]?.toLowerCase())&&fields[1]?.toLowerCase()==='email')continue;
  if(fields.length!==2||!fields[0]||!fields[1]){errors.push(`Line ${index+1}: use Name, email with exactly two columns.`);continue;}
  recipients.push({display_name:fields[0],email:fields[1]});
 }
 if(!recipients.length&&!errors.length)errors.push('Paste at least one name and email.');
 return {recipients,errors};
}
