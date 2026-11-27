import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.57.0";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const DEMO_SCHOOL = "TagIn Demo Academy";
const DEMO_SLUG = "tagin-demo-academy";
const phoneList = {
  admin: "08000000001", teacher: "08000000002", gate: "08000000003",
  office: "08000000004", driver: "08000000005", assistant: "08000000006",
  parentA: "08000000007", parentB: "08000000008",
};
function randomPassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}
async function alias(phone: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(phone.startsWith("0") ? "+234" + phone.slice(1) : phone));
  const hex = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  return "u-" + hex + "@login.tagin.invalid";
}
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
async function account(admin: any, schoolId: string, actorId: string, spec: { key: string; name: string; phone: string; role: string; jobTitle?: string; department?: string }) {
  const email = await alias(spec.phone);
  let userId: string;
  let user = (await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })).data.users.find((u: any) => u.email === email);
  const password = randomPassword();
  if (user) {
    if (user.app_metadata?.tagin_demo !== true) throw new Error("The reserved demo login " + spec.phone + " is already used by a non-demo account. No existing account was changed.");
    const { data, error } = await admin.auth.admin.updateUserById(user.id, { password, app_metadata: { ...user.app_metadata, tagin_demo: true } });
    if (error || !data.user) throw new Error("Could not refresh demo login for " + spec.name);
    userId = data.user.id;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: spec.name, phone: spec.phone, tagin_demo: true },
      app_metadata: { tagin_demo: true },
    });
    if (error || !data.user) throw new Error("Could not create login for " + spec.name + ": " + (error?.message ?? "unknown error"));
    userId = data.user.id;
  }
  const { error: profileError } = await admin.from("profiles").upsert({
    id: userId, full_name: spec.name, phone: spec.phone, platform_role: "user",
    is_active: true, must_change_password: false, temporary_password_expires_at: null,
  }, { onConflict: "id" });
  if (profileError) throw new Error("Could not save the profile for " + spec.name + ": " + profileError.message);
  let membershipId: string | null = null;
  if (spec.role !== "platform_only") {
    const { data: membership, error: membershipError } = await admin.from("school_memberships")
      .upsert({ school_id: schoolId, user_id: userId, role: spec.role, status: "active" }, { onConflict: "school_id,user_id,role" })
      .select("id").single();
    if (membershipError || !membership) throw new Error("Could not assign " + spec.name + " to the demo school: " + (membershipError?.message ?? ""));
    membershipId = membership.id;
    if (spec.role === "staff") {
      const { error: staffError } = await admin.from("staff_profiles").upsert({
        membership_id: membershipId, job_title: spec.jobTitle ?? "Teacher", department: spec.department ?? "Academics",
      }, { onConflict: "membership_id" });
      if (staffError) throw new Error("Could not save staff details for " + spec.name);
      const perms = ["students.read_basic", "students.create", "gate.check_in", "gate.check_out"].map(permission_key => ({ membership_id: membershipId, permission_key, granted_by: actorId }));
      const { error: permError } = await admin.from("staff_permissions").upsert(perms, { onConflict: "membership_id,permission_key" });
      if (permError) throw new Error("Could not save staff permissions for " + spec.name);
    }
  }
  return { userId, membershipId, password, name: spec.name, phone: spec.phone, role: spec.role };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return reply(401, { error: "Sign in as Platform Admin first." });
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return reply(500, { error: "Demo setup service is not configured." });
  const publicClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: auth, error: authError } = await publicClient.auth.getUser(authHeader.slice(7));
  if (authError || !auth.user) return reply(401, { error: "Your session could not be verified. Please sign in again." });
  const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: actor, error: actorError } = await admin.from("profiles").select("platform_role,is_active").eq("id", auth.user.id).maybeSingle();
  if (actorError || !actor || actor.platform_role !== "super_admin" || actor.is_active !== true) return reply(403, { error: "Only an active Platform Admin can create the demo school." });

  try {
    let { data: school, error: schoolError } = await admin.from("schools").select("id,name,slug").eq("slug", DEMO_SLUG).maybeSingle();
    if (schoolError) throw new Error("Could not check for an existing demo school.");
    if (school && school.name !== DEMO_SCHOOL) throw new Error("The reserved demo school URL is already used by another school. No records were changed.");
    if (!school) {
      const created = await admin.from("schools").insert({ name: DEMO_SCHOOL, slug: DEMO_SLUG, address: "Demo address · Ikeja, Lagos, Nigeria", status: "active", photos_enabled: true }).select("id,name,slug").single();
      if (created.error || !created.data) throw new Error("Could not create the demo school: " + (created.error?.message ?? ""));
      school = created.data;
    }
    const schoolId = school.id;

    const specs = [
      { key: "admin", name: "Alex Morgan", phone: phoneList.admin, role: "school_admin" },
      { key: "teacher", name: "Grace Johnson", phone: phoneList.teacher, role: "staff", jobTitle: "Teacher", department: "Primary Education" },
      { key: "gate", name: "Daniel Okafor", phone: phoneList.gate, role: "gate_staff" },
      { key: "office", name: "Esther Williams", phone: phoneList.office, role: "staff", jobTitle: "School Office Staff", department: "Administration" },
      { key: "driver", name: "Samuel Adeyemi", phone: phoneList.driver, role: "bus_staff" },
      { key: "assistant", name: "Mary Bello", phone: phoneList.assistant, role: "bus_staff" },
      { key: "parentA", name: "Olivia Carter", phone: phoneList.parentA, role: "parent" },
      { key: "parentB", name: "Michael James", phone: phoneList.parentB, role: "parent" },
    ];
    const people: Record<string, any> = {};
    for (const spec of specs) people[spec.key] = await account(admin, schoolId, auth.user.id, spec);

    // Reuse the two original demo class records rather than leaving obsolete empty classes behind.
    for (const legacy of [
      { from: "Nursery 2", to: "Prep One", level: "Early Years" },
      { from: "Primary 2", to: "Prep Two", level: "Early Years" },
    ]) {
      const { data: legacyClass } = await admin.from("school_classes").select("id").eq("school_id", schoolId).eq("class_name", legacy.from).maybeSingle();
      if (legacyClass) {
        const { error } = await admin.from("school_classes").update({ class_name: legacy.to, level: legacy.level }).eq("id", legacyClass.id);
        if (error) throw new Error("Could not update the existing demo class " + legacy.from + ".");
      }
    }
    const classSpecs = [
      { class_name: "Prep One", level: "Early Years" },
      { class_name: "Prep Two", level: "Early Years" },
      { class_name: "Nursery", level: "Early Years" },
      { class_name: "Kindergarten", level: "Early Years" },
      { class_name: "Grade One", level: "Primary" },
      { class_name: "Grade Two", level: "Primary" },
      { class_name: "Grade Three", level: "Primary" },
      { class_name: "Grade Four", level: "Primary" },
      { class_name: "Grade Five", level: "Primary" },
      { class_name: "GSS One", level: "Junior Secondary" },
      { class_name: "GSS Two", level: "Junior Secondary" },
      { class_name: "GSS Three", level: "Junior Secondary" },
      { class_name: "SS One", level: "Senior Secondary" },
      { class_name: "SS Two", level: "Senior Secondary" },
      { class_name: "SS Three", level: "Senior Secondary" },
    ];
    const classes: Record<string, any> = {};
    for (const spec of classSpecs) {
      const { data, error } = await admin.from("school_classes").upsert({
        school_id: schoolId, ...spec,
        teacher_membership_id: people.teacher.membershipId,
        created_by: auth.user.id,
      }, { onConflict: "school_id,level,class_name" }).select("id,class_name,level").single();
      if (error || !data) throw new Error("Could not create demo class " + spec.class_name);
      classes[spec.class_name] = data;
    }

    const originalNames = [
      "Ava Carter", "Noah Carter", "Ethan James", "Mia Carter", "Liam Carter",
      "Zoe Carter", "Daniel James", "Chloe James", "Isaac James", "Amara Okafor",
      "David Okafor", "Grace Williams", "Oliver Williams", "Sophia Williams",
      "Benjamin Adeyemi", "Isabella Bello", "Samuel Bello", "Ella Johnson",
      "James Johnson", "Mason Okafor",
    ];
    const givenNames = [
      "Aria", "Caleb", "Layla", "Nathan", "Ruby", "Jayden", "Naomi", "Felix",
      "Hannah", "Dylan", "Ivy", "Aaron", "Leah", "Elijah", "Maya", "Jordan",
      "Faith", "Adrian", "Stella", "Gabriel", "Nora", "Emmanuel", "Talia",
      "Peter", "Amelia", "Victor",
    ];
    const familyNames = ["Anderson", "Bennett", "Campbell", "Dawson", "Edwards"];
    const generatedNames = familyNames.flatMap(family => givenNames.map(given => given + " " + family));
    const rosterNames = [...originalNames, ...generatedNames];
    if (rosterNames.length !== 150) throw new Error("The demo roster must contain exactly 150 students.");
    const studentSpecs = classSpecs.flatMap((classSpec, classIndex) =>
      Array.from({ length: 10 }, (_, studentIndex) => {
        const index = classIndex * 10 + studentIndex;
        return {
          name: rosterNames[index],
          admission: "TDA-" + String(index + 1).padStart(3, "0"),
          className: classSpec.class_name,
          parent: index % 2 === 0 ? "parentA" : "parentB",
          usesBus: index % 2 === 0,
        };
      }),
    );
    const students: any[] = [];
    for (const spec of studentSpecs) {
      const cls = classes[spec.className];
      const { data: prior } = await admin.from("students").select("id").eq("school_id", schoolId).eq("full_name", spec.name).maybeSingle();
      let student: any = prior;
      if (!student) {
        const inserted = await admin.from("students").insert({
          school_id: schoolId, full_name: spec.name, class_id: cls.id,
          class_name: cls.class_name, level: cls.level, uses_bus: spec.usesBus, active: true,
        }).select("id,full_name,class_id,class_name,level").single();
        if (inserted.error || !inserted.data) throw new Error("Could not create demo student " + spec.name);
        student = inserted.data;
      } else {
        const updated = await admin.from("students").update({ class_id: cls.id, class_name: cls.class_name, level: cls.level, uses_bus: spec.usesBus, active: true }).eq("id", student.id).select("id,full_name,class_id,class_name,level").single();
        if (updated.error || !updated.data) throw new Error("Could not update demo student " + spec.name);
        student = updated.data;
      }
      students.push({ ...student, ...spec });
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      const tokenHash = await hash(token);
      const { error: qrError } = await admin.rpc("seed_demo_student_qr", {
        p_student_id: student.id, p_school_id: schoolId, p_token: token, p_token_hash: tokenHash,
      });
      if (qrError) throw new Error("Could not create the secure QR credential for " + spec.name + ": " + qrError.message);
      const guardian = people[spec.parent];
      const guardianName = guardian.name;
      const { data: guardianRow, error: guardianError } = await admin.from("guardians").upsert({
        school_id: schoolId, user_id: guardian.userId, full_name: guardianName,
        relationship: "Parent", phone: guardian.phone,
      }, { onConflict: "school_id,user_id" }).select("id").single();
      if (guardianError || !guardianRow) throw new Error("Could not link the parent account for " + spec.name);
      const { error: linkError } = await admin.from("student_guardians").upsert({
        school_id: schoolId, student_id: student.id, guardian_id: guardianRow.id, is_primary: true,
      }, { onConflict: "student_id,guardian_id" });
      if (linkError) throw new Error("Could not connect parent and student records.");
    }

    const { data: vehicle, error: vehicleError } = await admin.from("transport_vehicles")
      .upsert({ school_id: schoolId, registration_number: "DEMO-TAGIN-01", vehicle_name: "TagIn School Bus", capacity: 18, active: true }, { onConflict: "school_id,registration_number" })
      .select("id").single();
    if (vehicleError || !vehicle) throw new Error("Could not set up the demo bus.");
    let { data: route } = await admin.from("transport_routes").select("id").eq("school_id", schoolId).eq("name", "Ikeja Demo Route").maybeSingle();
    if (!route) {
      const createdRoute = await admin.from("transport_routes").insert({ school_id: schoolId, name: "Ikeja Demo Route", direction: "both", vehicle_id: vehicle.id, active: true }).select("id").single();
      if (createdRoute.error || !createdRoute.data) throw new Error("Could not set up the demo bus route.");
      route = createdRoute.data;
    }
    const stopSpecs = [{ stop_name: "Ikeja Demo Estate", stop_order: 1, scheduled_time: "07:00" }, { stop_name: "TagIn Demo Academy", stop_order: 2, scheduled_time: "07:40" }];
    const stops: any[] = [];
    for (const spec of stopSpecs) {
      const { data, error } = await admin.from("transport_stops").upsert({ school_id: schoolId, route_id: route.id, ...spec }, { onConflict: "route_id,stop_order" }).select("id").single();
      if (error || !data) throw new Error("Could not set up the demo route stops.");
      stops.push(data);
    }
    for (const [key, assignmentType] of [["driver", "driver"], ["assistant", "assistant"]] as const) {
      const { error } = await admin.from("transport_route_drivers").upsert({
        school_id: schoolId, route_id: route.id, membership_id: people[key].membershipId, assignment_type: assignmentType, active: true,
      }, { onConflict: "route_id,membership_id" });
      if (error) throw new Error("Could not assign the demo bus crew.");
    }
    for (const student of students.filter(s => s.usesBus)) {
      const { error } = await admin.from("transport_route_students").upsert({
        school_id: schoolId, route_id: route.id, student_id: student.id, pickup_stop_id: stops[0].id, dropoff_stop_id: stops[1].id, active: true,
      }, { onConflict: "route_id,student_id" });
      if (error) throw new Error("Could not assign a demo student to the bus route.");
    }

    const assessmentName = "Mathematics Mid-Term Test";
    let { data: assessment } = await admin.from("assessments").select("id").eq("school_id", schoolId).eq("assessment_name", assessmentName).eq("class_name", "Grade Two").maybeSingle();
    if (!assessment) {
      const created = await admin.from("assessments").insert({
        school_id: schoolId, class_name: "Grade Two", subject_name: "Mathematics", assessment_name: assessmentName,
        assessment_type: "test", academic_year: "2026/2027", term: "First Term", max_score: 100,
        teacher_membership_id: people.teacher.membershipId, status: "published", assessment_date: "2026-11-20", created_by: people.teacher.userId,
      }).select("id").single();
      if (created.error || !created.data) throw new Error("Could not create the demo assessment.");
      assessment = created.data;
    }
    for (const [i, student] of students.filter(s => s.className === "Grade Two").entries()) {
      const { data: score } = await admin.from("assessment_scores").select("id").eq("assessment_id", assessment.id).eq("student_id", student.id).maybeSingle();
      if (!score) {
        const { error } = await admin.from("assessment_scores").insert({
          school_id: schoolId, assessment_id: assessment.id, student_id: student.id,
          score: [86, 92, 78, 88, 74, 95, 81, 90, 84, 76][i], remarks: i === 0 ? "Good understanding; keep practising." : "Good effort and continued progress.",
          entered_by: people.teacher.userId,
        });
        if (error) throw new Error("Could not add demo assessment scores.");
      }
    }

    const timetableRows = [
      { class_name: "Grade Two", subject_name: "Mathematics", weekday: 1, start_time: "08:00", end_time: "08:45" },
      { class_name: "Primary 2", subject_name: "English Language", weekday: 1, start_time: "09:00", end_time: "09:45" },
      { class_name: "Nursery", subject_name: "Numeracy", weekday: 2, start_time: "10:00", end_time: "10:30" },
    ];
    for (const row of timetableRows) {
      const { data: exists } = await admin.from("timetable_entries").select("id").eq("school_id", schoolId).eq("teacher_membership_id", people.teacher.membershipId).eq("class_name", row.class_name).eq("subject_name", row.subject_name).eq("weekday", row.weekday).maybeSingle();
      if (!exists) {
        const { error } = await admin.from("timetable_entries").insert({ school_id: schoolId, ...row, teacher_membership_id: people.teacher.membershipId, created_by: people.teacher.userId });
        if (error) throw new Error("Could not create the demo timetable.");
      }
    }

    const collector = await admin.from("authorized_collectors").select("id").eq("school_id", schoolId).eq("student_id", students[2].id).eq("full_name", "Sophia James").maybeSingle();
    if (!collector.data) {
      const { error } = await admin.from("authorized_collectors").insert({
        school_id: schoolId, student_id: students[2].id, full_name: "Sophia James", relationship: "Aunt", phone: "08000000009", standing: true,
      });
      if (error) throw new Error("Could not create the demo pickup authorisation.");
    }

    const eventDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    for (const student of students) {
      const { data: existingAttendance } = await admin.from("scan_events").select("id").eq("school_id", schoolId).eq("student_id", student.id).limit(1);
      if (!existingAttendance?.length) {
        const { data: tag } = await admin.from("tags").select("id").eq("school_id", schoolId).eq("student_id", student.id).eq("status", "active").eq("tag_type", "bag").maybeSingle();
        if (tag) {
          const { error: checkinError } = await admin.from("scan_events").insert({ school_id: schoolId, student_id: student.id, tag_id: tag.id, event_type: "check_in", scanned_by: people.gate.userId, created_at: eventDate });
          if (checkinError) throw new Error("Could not add demo attendance history.");
        }
      }
    }

    const { data: existingTransport } = await admin.from("transport_events").select("id").eq("school_id", schoolId).limit(1);
    if (!existingTransport?.length) {
      const { error: transportError } = await admin.from("transport_events").insert([
        { school_id: schoolId, route_id: route.id, student_id: students[0].id, vehicle_id: vehicle.id, stop_id: stops[0].id, event_type: "picked_up", note: "Demo journey update", scanned_by: people.driver.userId, created_at: eventDate },
        { school_id: schoolId, route_id: route.id, student_id: students[0].id, vehicle_id: vehicle.id, stop_id: stops[1].id, event_type: "arrived_at_school", note: "Demo journey update", scanned_by: people.assistant.userId, created_at: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString() },
        { school_id: schoolId, route_id: route.id, student_id: students[1].id, vehicle_id: vehicle.id, stop_id: stops[0].id, event_type: "picked_up", note: "Demo journey update", scanned_by: people.driver.userId, created_at: eventDate },
      ]);
      if (transportError) throw new Error("Could not add demo transport history.");
    }

    await admin.from("audit_logs").insert({
      school_id: schoolId, actor_user_id: auth.user.id, action: "demo.school_seeded",
      entity_type: "school", entity_id: schoolId,
      metadata: { school_name: DEMO_SCHOOL, demo_only: true, students: students.length, account_count: specs.length },
    });

    const credentials = specs.map(spec => ({
      role: spec.role === "school_admin" ? "School Admin" : spec.role === "staff" ? (spec.key === "teacher" ? "Teacher" : "General Staff") : spec.role === "gate_staff" ? "Gate Staff" : spec.role === "bus_staff" ? (spec.key === "driver" ? "Bus Driver" : "Bus Assistant") : "Parent / Guardian",
      fullName: people[spec.key].name,
      phone: people[spec.key].phone,
      password: people[spec.key].password,
    }));
    return reply(200, {
      success: true, school: { id: schoolId, name: DEMO_SCHOOL, slug: DEMO_SLUG },
      summary: { classes: classSpecs.length, students: students.length, studentsPerClass: 10, parents: 2, staffAccounts: 6, transportRoutes: 1, qrPasses: students.length, sampleAttendance: true, sampleResults: true, sampleTransport: true },
      credentials,
      note: "These are fictional demo identities. Phone numbers are login identifiers only and are not contactable phone numbers.",
    });
  } catch (error) {
    console.error("create-demo-school failed", error);
    return reply(500, { error: error instanceof Error ? error.message : "Demo school setup failed. Please retry; completed steps are safe to rerun." });
  }
});
