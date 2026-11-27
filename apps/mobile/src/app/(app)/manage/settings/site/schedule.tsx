import { Redirect } from 'expo-router';

/** Расписание сайта стало общим расписанием клуба: сайт, Tai, касса и опросы — из одного места. */
export default function SiteScheduleRedirect() {
  return <Redirect href="/manage/schedule" />;
}
