import type { help as es } from "../es/help";
import type { Translation } from "../types";

export const help: Translation<typeof es> = {
  "nav.help": "Help",
  "help.title": "Help",
  "help.subtitle": "Frequently asked questions and contact channels",
  "help.search.label": "Search the frequently asked questions",
  "help.search.placeholder": "Search: loan, password, reservation...",
  "help.search.clear": "Clear search",
  "help.results": "{count} result | {count} results",
  "help.loading": "Loading help...",
  "help.error.title": "We could not load the help section",
  "help.error.text":
    "The FAQ configuration could not be read. Try again in a few minutes or contact us if the problem persists.",
  "help.error.detail": "Technical details",
  "help.empty.title": "No results",
  "help.empty.text":
    "We found no questions matching “{query}”. Try another word or contact us.",
  "help.empty.clear": "Show all questions",
  "help.contact.email": "Contact email",
  "help.contact.schedule": "Support hours",
  "help.contact.responseTime": "Response time",
  "help.contact.cta": "Email the help team",
  "help.doubt.title": "Still have questions?",
  "help.doubt.text":
    "Tell us what you need and we will get back to you shortly. If your question is about a ticket or a loan, include its number.",
  "help.guide": "Open the getting-started guide",
  "help.mailSubject": "Question from the help section",
  "help.faq": "Frequently asked questions",
  "help.category.tickets": "Tickets and support",
  "help.category.loans": "Loans",
  "help.category.services": "Service requests",
  "help.category.reservations": "Reservations",
  "help.category.account": "Account and accessibility",
};
