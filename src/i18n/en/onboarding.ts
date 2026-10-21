import type { onboarding as es } from "../es/onboarding";
import type { Translation } from "../types";

export const onboarding: Translation<typeof es> = {
  "onboarding.title": "Quick guide",
  "onboarding.stepOf": "Step {current} of {total}",
  "onboarding.skip": "Skip",
  "onboarding.finish": "Done",
  "onboarding.reopen": "View guide",
  "onboarding.progress": "Guide progress",
  "onboarding.flow": "Usual flow",
  "onboarding.preferences.note": "You can change them any time from Profile.",

  "onboarding.welcome.title": "Welcome aboard",
  "onboarding.welcome.requester":
    "From here you ask for help with the institute's technology and follow every request until it is resolved.",
  "onboarding.welcome.staff":
    "From here you manage the community's requests: tickets, services, loans and equipment.",
  "onboarding.welcome.point1": "Requests, statuses and notices in one place",
  "onboarding.welcome.point2": "Everything is recorded for later reference",
  "onboarding.welcome.point3": "You can change the language at any time",

  "onboarding.flow.report": "Report the issue",
  "onboarding.flow.follow": "Track the status",
  "onboarding.flow.resolved": "Resolution and notice",
  "onboarding.flow.incoming": "Request comes in",
  "onboarding.flow.resolve": "Claim and resolve",
  "onboarding.flow.close": "Close and notify",

  "onboarding.reportTicket.title": "Report an issue",
  "onboarding.reportTicket.description":
    "A ticket says what is happening and on which equipment. If it has a QR code, scan it from the form.",
  "onboarding.reportTicket.point1": "Pick a category, equipment and description",
  "onboarding.reportTicket.point2": "Follow the status and comments",
  "onboarding.reportTicket.point3": "You get a notice when it is resolved",

  "onboarding.workQueue.title": "Your work queue",
  "onboarding.workQueue.description":
    "New tickets arrive unassigned; claim the ones you can handle and move them through their statuses.",
  "onboarding.workQueue.point1": "Claim unassigned tickets",
  "onboarding.workQueue.point2": "Leave the diagnosis when moving to resolution",
  "onboarding.workQueue.point3": "Resolve: the requester gets a notice",

  "onboarding.requestService.title": "Service requests and reservations",
  "onboarding.requestService.description":
    "Ask for a lab to be prepared, software installed, or book equipment and spaces by date and time.",
  "onboarding.requestService.point1": "Add a reason and details",
  "onboarding.requestService.point2": "Book equipment or a location",
  "onboarding.requestService.point3": "Follow approval in each section",

  "onboarding.manageRequests.title": "Service requests and reservations",
  "onboarding.manageRequests.description":
    "Approve, reject or reschedule requests from each list; the resolution is recorded.",
  "onboarding.manageRequests.point1": "Approve or reject with a reason",
  "onboarding.manageRequests.point2": "Coordinate dates and resources",
  "onboarding.manageRequests.point3": "Close with a written resolution",

  "onboarding.loans.title": "Equipment loans",
  "onboarding.loans.description":
    "Request equipment on loan and return it from the same section when you are done.",
  "onboarding.loans.point1": "Request with date and reason",
  "onboarding.loans.point2": "Follow approval and delivery",
  "onboarding.loans.point3": "Mark the return when finished",

  "onboarding.staffTools.title": "Inventory and equipment",
  "onboarding.staffTools.description":
    "Every item has its ID, location and intervention history, and loans come from there.",
  "onboarding.staffTools.point1": "Create and edit equipment and components",
  "onboarding.staffTools.point2": "Equipment status and interventions",
  "onboarding.staffTools.point3": "Locations and loans under control",

  "onboarding.adminPanel.title": "Admin panel",
  "onboarding.adminPanel.description.admin":
    "Manage users, review activity and download system reports.",
  "onboarding.adminPanel.description.root":
    "Besides users and reports, as root_admin you define roles and permissions.",
  "onboarding.adminPanel.point1": "Users: create, role and status",
  "onboarding.adminPanel.point2": "Activity logs and reports",
  "onboarding.adminPanel.point3": "System roles and permissions",

  "onboarding.preferences.title": "Make it yours",
  "onboarding.preferences.description":
    "Theme, font size, contrast and dyslexia font. They apply instantly and are saved in this browser.",
};
