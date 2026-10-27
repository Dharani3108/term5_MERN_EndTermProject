# End-Term Submission Sheet

Copy these answers into the official form: https://forms.gle/sBy4sfqyiRG2Zpom9
Deadline: **27 October 2026, 11:59 PM IST**.

| Field | Answer |
| --- | --- |
| Project Name | SlotWise |
| Student Name | Lakshmi Dharani Varada |
| Problem Statement | Shared campus spaces such as study rooms, labs, equipment and courts are booked through spreadsheets and group chats. This leads to double bookings, rooms reserved but left empty, a few people hoarding prime hours, and no way for staff to see real usage. SlotWise is a booking platform that prevents conflicts, enforces fair-use limits, releases no-show bookings automatically, hands freed time to a waitlist, and gives administrators usage analytics. |
| GitHub Repository | `<https://github.com/you/slotwise>` |
| Deployed Application | `<https://slotwise.onrender.com>` |
| Demo Video | `<link, shared as "anyone with the link">` |
| Tech Stack | Node.js 22, Express 5, SQLite (built-in node:sqlite), Server-Sent Events, vanilla JavaScript ES modules and CSS, node:test, Render, Docker, GitHub Actions |
| Major Features | Live slot-grid booking with transactional conflict prevention and idempotent requests; FIFO waitlist with automatic promotion; check-in with automatic no-show release, strikes and suspension; weekly quotas and booking caps; real-time notifications and schedule updates; admin resource management, blackout periods with automatic cancellation, booking oversight and user roles; utilisation analytics with a demand heatmap; session auth with scrypt, CSRF protection, CSP and rate limiting; 33 automated tests. |

## Before you submit

- [ ] Push to a **public** GitHub repository and open it in a private window.
- [ ] Deploy with the Render blueprint, set `ADMIN_PASSWORD`, and open the URL in a private window.
- [ ] Fill the live URL and video link into `README.md` and this sheet, then commit.
- [ ] Upload the demo video with link sharing enabled and test it in a private window.
- [ ] Submit the form.

## Demo video script (about 4 minutes)

1. **Problem, 30 s.** Show the login page. Explain the double bookings, ghost bookings and hoarding problem, and that the users are students and facilities staff.
2. **Discover, 30 s.** Sign in as the demo student. Show the weekly quota strip, then search and filter spaces and point out the "Free now" badges.
3. **Book, 45 s.** Open Library Study Room A, pick tomorrow, select two slots and book. Show the success toast, the slot turning green, and the booking under My bookings with its check-in time.
4. **Rules, 30 s.** Try a range longer than the maximum and show the message. Mention quota, overlap and no-show suspension rules, all enforced on the server.
5. **Waitlist and real time, 60 s.** Select the booked 10:00 slot tomorrow and join the waitlist. In a second browser, sign in as admin, go to Admin, then Bookings, and cancel that booking with a reason. Switch back: the student gets a live alert and the booking appears with a "From waitlist" tag.
6. **Admin, 45 s.** Show the analytics dashboard and heatmap. Add a blackout and show the count of cancelled bookings. Deactivate or edit a resource.
7. **Engineering, 20 s.** Briefly show the architecture diagram in the README and the passing `npm test` output.
