-- Drop the blanket uniqueness on (studentId, courseId, raisedById).
--
-- It made a referral permanent: after a case was closed the teacher could never
-- raise another concern about the same student in the same course. It was also
-- inert for rows with a NULL courseId, because SQL treats NULLs as distinct in
-- unique indexes, so duplicates were already possible there.
--
-- The "one open referral per student/course/raiser" rule now lives in the
-- route, where it can be scoped to status = 'open'.
DROP INDEX IF EXISTS "WellbeingReferral_studentId_courseId_raisedById_key";

-- Same columns, but as a plain index to support the duplicate lookup.
CREATE INDEX "WellbeingReferral_studentId_courseId_raisedById_status_idx"
ON "WellbeingReferral"("studentId", "courseId", "raisedById", "status");
