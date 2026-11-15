import { IInvite } from '@/models/types/misc/invite';
import { readApiResponse } from '../api-response';
export default async function RegisterHelper({namePassed, emailPassed, pwPassed, invite}: {namePassed:string; emailPassed:string; pwPassed:string; invite:IInvite|null}) {
  try {
    const response = await fetch('/api/register', {method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({namePassed,emailPassed,password:pwPassed,invite:invite ? {token:invite.token} : null})});
    const result = await readApiResponse<{verificationRequired?:boolean}>(response, 'Unable to register');
    return {status:result.status, message:result.message, verificationRequired:result.data?.verificationRequired, newUser:null};
  } catch { return {status:false,message:'Unable to register',newUser:null}; }
}
