/** /app/android — постоянная ссылка «Скачать для Android»: ведёт на последний APK My Titan. */
import { NextResponse } from 'next/server'
import { getAndroidApk } from '@/lib/apk'

export const revalidate = 300

export async function GET(): Promise<NextResponse> {
  const { url } = await getAndroidApk()
  return NextResponse.redirect(url, 302)
}
