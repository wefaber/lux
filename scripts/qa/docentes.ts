/* oxlint-disable typescript/no-explicit-any */
// Perfil docente (#100): flag, reservas restringidas y horarios de clase. Corre
// contra una API con el seed cargado y ESCRIBE datos (crea reservas y cambia
// usuarios): usar una base descartable, no la de produccion.
//
//   bun scripts/qa/docentes.ts --target http://127.0.0.1:4111
const targetArg = process.argv.indexOf("--target");
const target = (targetArg >= 0 ? process.argv[targetArg + 1] : "http://127.0.0.1:4111")!.replace(
  /\/$/,
  "",
);
const endpoint = target.endsWith("/graphql") ? target : `${target}/graphql`;
async function gql(q: string, vars: any = {}, token?: string) {
  const r = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query: q, variables: vars }),
  });
  return r.json() as Promise<any>;
}
async function login(dni: string, password: string) {
  const r = await gql(
    `query($d:String!,$p:String!){login(dni:$d,password:$p){token isTeacher role}}`,
    { d: dni, p: password },
  );
  return r.data.login as { token: string; isTeacher: boolean; role: string };
}
let fails = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (!cond) fails++;
  console.log(cond ? "ok  " : "FAIL", name, cond ? "" : JSON.stringify(extra));
};
const msg = (r: any) => r.errors?.[0]?.message ?? "";

const admin = await login("12345678", "admin2026");
const tec = await login("34567890", "tecnico2026");
const teacher = await login("67890123", "sol2026");
const student = await login("89012345", "sol2026");
check("login expone isTeacher", teacher.isTeacher === true && student.isTeacher === false, {
  teacher,
  student,
});

const list = await gql(
  `{ classSchedules { id weekday startTime endTime teacher { id name } location { id name } } }`,
  {},
  tec.token,
);
check("tecnico lista 5 horarios", list.data?.classSchedules?.length === 5, list);
const sdenied = await gql(`{ classSchedules { id } }`, {}, student.token);
check("solicitante no lista horarios", /permisos/i.test(msg(sdenied)), sdenied);

const at = (iso: string, loc = "loc-1") =>
  gql(
    `query($l:ID!,$a:String){ teacherInCharge(locationId:$l, at:$a){ id teacher{ id } startTime endTime } }`,
    { l: loc, a: iso },
    tec.token,
  );
// lunes 2026-11-02, Montevideo UTC-3
let r = await at("2026-11-02T11:30:00.000Z");
check("lun 08:30 -> u-sol-1", r.data?.teacherInCharge?.teacher?.id === "u-sol-1", r);
r = await at("2026-11-02T12:30:00.000Z");
check(
  "lun 09:30 -> u-sol-2 (fin exclusivo)",
  r.data?.teacherInCharge?.teacher?.id === "u-sol-2",
  r,
);
r = await at("2026-11-02T14:00:00.000Z");
check("lun 11:00 -> nadie", r.data?.teacherInCharge === null, r);
r = await at("2026-11-03T11:30:00.000Z");
check("martes 08:30 -> nadie", r.data?.teacherInCharge === null, r);
r = await at("basura");
check("fecha invalida -> error", /inválidas/.test(msg(r)), r);

const mk = (input: any, token = admin.token) =>
  gql(
    `mutation($i:ClassScheduleInput!){ createClassSchedule(input:$i){ id weekday teacher{ id } } }`,
    { i: input },
    token,
  );
const base = {
  locationId: "loc-5",
  teacherId: "u-sol-1",
  weekday: 5,
  startTime: "10:00",
  endTime: "11:30",
};
r = await mk({ ...base, startTime: "11:00", endTime: "10:00" });
check("rechaza franja invertida", /posterior/.test(msg(r)), r);
r = await mk({ ...base, teacherId: "u-sol-3" });
check("rechaza no docente", /docente activo/.test(msg(r)), r);
r = await mk({ ...base, locationId: "loc-1", weekday: 1, startTime: "08:30", endTime: "09:00" });
check("rechaza solape", /Ya hay una clase/.test(msg(r)), r);
r = await mk(base, tec.token);
check("tecnico no crea", /permisos/i.test(msg(r)), r);
r = await mk(base);
const newId = r.data?.createClassSchedule?.id;
check("admin crea", !!newId, r);
r = await gql(
  `mutation($id:ID!,$i:ClassScheduleInput!){ updateClassSchedule(id:$id,input:$i){ id endTime } }`,
  { id: newId, i: { ...base, endTime: "12:00" } },
  admin.token,
);
check("admin edita", r.data?.updateClassSchedule?.endTime === "12:00", r);

r = await gql(
  `mutation($id:ID!,$i:UserInput!){ updateUser(id:$id,input:$i){ id isTeacher } }`,
  {
    id: "u-sol-1",
    i: {
      name: "Ana García",
      dni: "67890123",
      email: "agarcia@iti.edu.uy",
      role: "solicitante",
      isTeacher: false,
    },
  },
  admin.token,
);
check("no se quita docente con horarios", /horarios de clase asignados/.test(msg(r)), r);

r = await gql(`mutation($id:ID!){ deleteClassSchedule(id:$id) }`, { id: newId }, admin.token);
check("admin borra", r.data?.deleteClassSchedule === true, r);
r = await gql(`mutation($id:ID!){ deleteClassSchedule(id:$id) }`, { id: newId }, admin.token);
check("borrar de nuevo -> no encontrado", /no encontrado/.test(msg(r)), r);

r = await gql(`{ users(isTeacher:true){ id } }`, {}, tec.token);
check("filtro users(isTeacher)", r.data?.users?.length === 2, r);

const res = {
  resourceType: "location",
  locationId: "loc-5",
  startsAt: new Date(Date.now() + 86400000 * 3).toISOString(),
  endsAt: new Date(Date.now() + 86400000 * 3 + 3600000).toISOString(),
  purpose: "Clase de prueba",
};
const reserve = (token: string, input: any = res) =>
  gql(
    `mutation($i:ReservationInput!){ createReservation(input:$i){ id status } }`,
    { i: input },
    token,
  );
r = await reserve(student.token);
check("solicitante comun no reserva", /docentes y el personal/.test(msg(r)), r);
r = await reserve(teacher.token);
check("docente reserva", !!r.data?.createReservation?.id, r);
const second = {
  ...res,
  startsAt: new Date(Date.now() + 86400000 * 5).toISOString(),
  endsAt: new Date(Date.now() + 86400000 * 5 + 3600000).toISOString(),
};
r = await reserve(tec.token, second);
check("tecnico reserva", !!r.data?.createReservation?.id, r);

// promover y degradar
r = await gql(
  `mutation($id:ID!,$i:UserInput!){ updateUser(id:$id,input:$i){ id isTeacher } }`,
  {
    id: "u-sol-3",
    i: {
      name: "Laura Martínez",
      dni: "89012345",
      email: "lmartinez@iti.edu.uy",
      role: "solicitante",
      isTeacher: true,
    },
  },
  admin.token,
);
check("admin habilita docente", r.data?.updateUser?.isTeacher === true, r);
const s2 = await login("89012345", "sol2026");
r = await reserve(s2.token, {
  ...res,
  startsAt: new Date(Date.now() + 86400000 * 8).toISOString(),
  endsAt: new Date(Date.now() + 86400000 * 8 + 3600000).toISOString(),
});
check("nuevo docente reserva", !!r.data?.createReservation?.id, r);
r = await gql(
  `mutation($id:ID!,$i:UserInput!){ updateUser(id:$id,input:$i){ id role isTeacher } }`,
  {
    id: "u-sol-3",
    i: { name: "Laura Martínez", dni: "89012345", email: "lmartinez@iti.edu.uy", role: "tecnico" },
  },
  admin.token,
);
check("cambio de rol limpia el flag", r.data?.updateUser?.isTeacher === false, r);
r = await gql(
  `mutation($i:UserInput!){ createUser(input:$i){ id isTeacher } }`,
  {
    i: {
      name: "Prueba Docente",
      dni: "99887766",
      email: "pd@iti.edu.uy",
      role: "tecnico",
      isTeacher: true,
      password: "xxxxxx2026",
    },
  },
  admin.token,
);
check("createUser tecnico ignora el flag", r.data?.createUser?.isTeacher === false, r);
console.log(fails ? `\n${fails} FALLAS` : "\ntodo ok");
process.exit(fails ? 1 : 0);
