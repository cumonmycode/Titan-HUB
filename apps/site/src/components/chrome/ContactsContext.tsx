'use client'
/** Контакты клуба для клиентских компонентов (шапка, нижняя панель, форма заявки). */
import { createContext, useContext, type ReactNode } from 'react'
import { contactsOf, type Contacts } from '@/lib/contacts'

const ContactsContext = createContext<Contacts>(contactsOf(null))

export function ContactsProvider({ value, children }: { value: Contacts; children: ReactNode }) {
  return <ContactsContext.Provider value={value}>{children}</ContactsContext.Provider>
}

export const useContacts = (): Contacts => useContext(ContactsContext)
