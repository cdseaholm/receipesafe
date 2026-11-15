'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import type { IUser } from '@/models/types/personal/user';
import type { RegisterFormType } from '@/models/types/misc/register';
import RegisterForm from '@/components/forms/personal/registerForm';
import NavWrapper from '@/components/wrappers/navWrapper';
import ContentWrapper from '@/components/wrappers/contentWrapper';
import { CreateUser } from '@/utils/server-actions/user/create';
import GoogleSignInButton from '@/components/buttons/googleSignInButton';
export default function RegisterPage({userInfo}: {userInfo:IUser|null}) {
  const [submitting,setSubmitting]=useState(false);
  const router=useRouter();
  async function handleRegister({registerForm}:{registerForm:RegisterFormType}) {
    if (registerForm.validate().hasErrors) return;
    setSubmitting(true);
    try {
      const values=registerForm.getValues();
      const result=await CreateUser({name:values.name,email:values.email,password:values.password});
      if (!result.status) {toast.error(result.message);return;}
      toast.success('Check your email to verify your account before signing in.');
      router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
    } catch {toast.error('Unable to register. Please try again.');}
    finally {setSubmitting(false);}
  }
  return <NavWrapper userInfo={userInfo}><ContentWrapper containedChild paddingNeeded>
    <h1 className="text-xl md:text-2xl">Register</h1>
    <div className="my-4 w-full max-w-md"><GoogleSignInButton label="Sign up with Google" /></div>
    <RegisterForm handleRegister={handleRegister} loading={submitting} />
  </ContentWrapper></NavWrapper>;
}
