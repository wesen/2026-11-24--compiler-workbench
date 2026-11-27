// model.ts
var constant = (value) => ({ constant: value, terms: [] });
var variable = (name2) => ({ constant: 0, terms: [[name2, 1]] });
function add(a, b, scale = 1) {
  const terms = new Map(a.terms);
  for (const [name2, k] of b.terms) terms.set(name2, (terms.get(name2) ?? 0) + k * scale);
  const result = {
    constant: a.constant + b.constant * scale,
    terms: [...terms].filter(([, k]) => k !== 0).sort(([x], [y]) => x < y ? -1 : 1)
  };
  if (![result.constant, ...result.terms.map(([, k]) => k)].every(Number.isSafeInteger))
    throw Error("Affine integer overflow");
  return result;
}
function plain(a) {
  return a.constant === 0 && a.terms.length === 1 && a.terms[0][1] === 1 ? a.terms[0][0] : void 0;
}
var width = 4;
function visit(e, f) {
  f(e);
  if (e.kind === "op") e.args.forEach((x) => visit(x, f));
  if (e.kind === "reduce") visit(e.body, f);
}

// fusion.ts
function outerReductions(e) {
  if (e.kind === "reduce") return [e];
  return e.kind === "op" ? e.args.flatMap(outerReductions) : [];
}
var same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function loads(s) {
  const out = [];
  visit(s.expr, (e) => {
    if (e.kind === "load") out.push(e);
  });
  return out;
}
var text = (a) => [
  ...a.terms.map(([n, k]) => k === 1 ? n : `${k}*${n}`),
  ...a.constant || !a.terms.length ? [a.constant] : []
].join(" + ");
function joinDepth(s, members, depth) {
  const names = new Set(members.map((m) => m.name));
  const reads = loads(s).filter((e) => names.has(e.name));
  if (!reads.length) return { depth: 0, reason: "reads no tensor of the kernel (no horizontal fusion)" };
  let k = Math.min(depth, s.axes.length), reason = `it has ${s.axes.length} ${s.axes.length === 1 ? "axis" : "axes"}`;
  for (let p = 0; p < k; p++)
    if (!same(s.shape[p], members[0].shape[p])) {
      [k, reason] = [
        p,
        `its axis ${p} has extent ${text(s.shape[p])}, the kernel's ${text(members[0].shape[p])}`
      ];
      break;
    }
  for (const r of reads)
    for (let p = 0; p < k; p++)
      if (plain(r.indices[p]) !== s.axes[p].id) {
        const at = text(r.indices[p]);
        [k, reason] = [p, `reads ${r.name} at index ${at} in position ${p}, not its own axis there`];
        break;
      }
  return { depth: k, reason };
}
var staging = { cheapOperations: 4 };
function work(e) {
  if (e.kind === "reduce") return Infinity;
  if (e.kind !== "op") return 0;
  return e.args.reduce((n, a) => n + work(a), ["+", "-", "*", "neg"].includes(e.op) ? 1 : Infinity);
}
var gate = { fullRow: 96, smallGrid: 1024, heavyLanes: [19, 24] };
function gateRule(v) {
  const rows = `(${v.longest} >= ${gate.fullRow} || ${v.grid} <= ${gate.smallGrid})`;
  const [n, d] = gate.heavyLanes;
  return [rows, ...v.lanes.map((l) => `${l} * ${d} >= ${n} * ${v.slots}`)].join(" && ");
}
function planFusion(fn) {
  const runs = [];
  const refusals = [], termRefusals = [];
  for (const s of fn.statements) {
    const current = runs.at(-1);
    if (current) {
      const join = joinDepth(s, current.members, current.depth);
      if (join.depth > 0) {
        if (join.depth < current.depth)
          current.reasons.push(
            `${s.name} narrows the block domain to ${join.depth} ${join.depth === 1 ? "axis" : "axes"}: ${join.reason}`
          );
        current.members.push(s);
        current.depth = join.depth;
        continue;
      }
      refusals.push({ statement: s.name, kernel: "k" + (runs.length - 1), reason: join.reason });
    }
    runs.push({ members: [s], depth: s.axes.length, reasons: [] });
  }
  const readers = /* @__PURE__ */ new Map();
  runs.forEach(
    (run, g) => run.members.forEach((s) => loads(s).forEach((e) => readers.set(e.name, [...readers.get(e.name) ?? [], g])))
  );
  const groups = runs.map(({ members, depth, reasons }, g) => {
    const names = new Set(members.map((m) => m.name));
    const single = members.length === 1;
    const stored = members.filter((m) => single || m.name === fn.result || (readers.get(m.name) ?? []).some((r) => r > g)).map((m) => m.name);
    const block = members.some((m) => m.axes.length > depth);
    const buffered = block ? members.filter((m, i) => members.slice(i + 1).some((r) => loads(r).some((e) => e.name === m.name))) : [];
    const staged = /* @__PURE__ */ new Set();
    const tensors = new Map([...fn.params, ...fn.statements].map((t) => [t.name, t]));
    if (block)
      for (const m of members)
        for (const e of loads(m)) {
          const t = tensors.get(e.name);
          if (names.has(e.name) || t.shape.length <= depth) continue;
          const rows = members[0].shape.slice(0, depth);
          if (rows.every((d, p) => same(d, t.shape[p]) && plain(e.indices[p]) === m.axes[p].id))
            staged.add(e.name);
        }
    const terms = [], heavy = /* @__PURE__ */ new Set();
    const rowBuffers = /* @__PURE__ */ new Set([...staged, ...buffered.map((m) => m.name)]);
    if (block)
      for (const m of members) {
        const ownRow = (e) => rowBuffers.has(e.name) && e.indices.slice(0, depth).every((a, p) => plain(a) === m.axes[p].id);
        outerReductions(m.expr).forEach((r, reduction) => {
          const refuse = (reason) => termRefusals.push({
            statement: m.name,
            kernel: "k" + g,
            reason: `${r.op} ${reduction}: ${reason}`
          });
          if (r.body.kind === "load" && ownRow(r.body)) return;
          const n = work(r.body);
          if (m.axes.length > depth) {
            if (n >= staging.cheapOperations) heavy.add(m.name);
            return refuse("every thread of the block computes elements of the row, so none is idle");
          }
          if (n < staging.cheapOperations)
            return refuse(
              `the body is ${n} single-instruction operation${n === 1 ? "" : "s"}; below ${staging.cheapOperations} one thread's loop is faster`
            );
          terms.push({ statement: m.name, reduction });
        });
      }
    const inPlace = [];
    if (block)
      members.forEach((b, at) => {
        if (b.axes.length === depth || !rowBuffers.has(b.name)) return;
        const own = (e) => e.indices.length === b.axes.length && e.indices.every((a, p) => plain(a) === b.axes[p].id);
        const over = [...rowBuffers].find((a) => {
          const reads = loads(b).filter((e) => e.name === a);
          const rest = tensors.get(a).shape.slice(depth);
          return a !== b.name && reads.length > 0 && reads.every(own) && rest.length === b.shape.length - depth && rest.every((d, p) => same(d, b.shape[depth + p])) && !members.slice(at + 1).some((m) => loads(m).some((e) => e.name === a));
        });
        if (over) inPlace.push({ statement: b.name, over });
      });
    const axes = members[0].shape.slice(0, depth).map(text).join(", ");
    const why = single ? [] : block ? [
      `one block per point of [${axes}] instead of one thread per element; the members run in order, separated by barriers, each element by one thread`,
      ...members.filter((m) => m.axes.length === depth).map((m) => `thread 0 computes ${m.name} (one element per row) in the meaning's order`),
      ...staged.size ? [`rows of ${[...staged].join(", ")} are staged in the row buffer`] : [],
      ...inPlace.map((p) => `${p.statement} is written over the row of ${p.over}`),
      ...terms.map(
        (t) => `all threads compute the terms of ${t.statement}'s reduction ${t.reduction}; thread 0 folds them in order`
      )
    ] : [
      `one thread per element of [${axes}] computes ${members.map((m) => m.name).join(", ")} in registers`
    ];
    return {
      kernel: "k" + g,
      statements: members.map((m) => m.name),
      depth,
      mapping: block ? "block" : "thread",
      stored,
      buffered: buffered.map((m) => m.name),
      staged: [...staged],
      terms,
      inPlace,
      heavy: [...heavy],
      gated: block,
      reasons: [...why, ...reasons]
    };
  });
  return { fn: fn.name, groups, refusals, termRefusals };
}
function unfusedPlan(fn) {
  return {
    fn: fn.name,
    groups: fn.statements.map((s, g) => ({
      kernel: "k" + g,
      statements: [s.name],
      depth: s.axes.length,
      mapping: "thread",
      stored: [s.name],
      buffered: [],
      staged: [],
      terms: [],
      inPlace: [],
      heavy: [],
      gated: false,
      reasons: []
    })),
    refusals: [],
    termRefusals: []
  };
}

// cuda-source.ts
var support = String.raw`
#include <cuda_runtime.h>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <memory>
#include <stdexcept>
#include <vector>

using I = int64_t;
using U = uint64_t;

static void check(cudaError_t status) {
  if (status != cudaSuccess) throw std::runtime_error(cudaGetErrorString(status));
}

__device__ static float minmax(float a, float b, bool maximum) {
  if (isnan(a) || isnan(b)) return __uint_as_float(0x7fc00000);
  if (a == b) {
    unsigned x = __float_as_uint(a), y = __float_as_uint(b);
    return __uint_as_float(maximum ? x & y : x | y);
  }
  return (maximum ? a > b : a < b) ? a : b;
}

struct DeviceBuffer {
  float* ptr = nullptr;
  U size;
  explicit DeviceBuffer(U n) : size(n) {
    if (size) check(cudaMalloc(&ptr, size * sizeof(float)));
  }
  ~DeviceBuffer() { if (ptr) cudaFree(ptr); }
  DeviceBuffer(const DeviceBuffer&) = delete;
  void upload(const float* src) const {
    if (size) check(cudaMemcpy(ptr, src, size * sizeof(float), cudaMemcpyHostToDevice));
  }
  void download(float* dst) const {
    if (size) check(cudaMemcpy(dst, ptr, size * sizeof(float), cudaMemcpyDeviceToHost));
  }
};

template <size_t N> static U elements(const std::array<I, N>& shape) {
  U n = 1;
  for (I extent : shape) n *= static_cast<U>(extent);
  return n;
}

template <class T> static void read(FILE* file, T* ptr, size_t count) {
  if (count && fread(ptr, sizeof(T), count, file) != count) throw std::runtime_error("short CUDA request");
}

template <class T> static void write(FILE* file, const T* ptr, size_t count) {
  if (count && fwrite(ptr, sizeof(T), count, file) != count) throw std::runtime_error("short CUDA response");
}

struct Event {
  cudaEvent_t handle;
  Event() { check(cudaEventCreate(&handle)); }
  ~Event() { cudaEventDestroy(handle); }
};

template <class Launch> static double time_kernels(const Launch& launch, bool benchmark) {
  Event start, stop;
  if (benchmark) {
    launch();
    check(cudaDeviceSynchronize());
  }
  std::array<float, 3> ms{};
  const int repeats = benchmark ? ms.size() : 1;
  for (int i = 0; i < repeats; ++i) {
    check(cudaEventRecord(start.handle));
    launch();
    check(cudaEventRecord(stop.handle));
    check(cudaEventSynchronize(stop.handle));
    check(cudaEventElapsedTime(&ms[i], start.handle, stop.handle));
  }
  if (benchmark) std::sort(ms.begin(), ms.end());
  return ms[repeats / 2];
}
`;
var main = String.raw`
int main(int argc, char** argv) {
  try {
    using File = std::unique_ptr<FILE, decltype(&fclose)>;
    File input(fopen("inputs.bin", "rb"), fclose);
    File output(fopen("out/results.bin", "wb"), fclose);
    if (!input || !output) throw std::runtime_error("cannot open CUDA request or response");
    const char magic[] = "TIXCUDA1";
    char header[8];
    read(input.get(), header, sizeof(header));
    if (memcmp(header, magic, sizeof(header))) throw std::runtime_error("bad CUDA request header");
    U count;
    read(input.get(), &count, 1);
    write(output.get(), magic, sizeof(header));
    write(output.get(), &count, 1);
    const bool benchmark = argc == 2 && strcmp(argv[1], "--benchmark") == 0;
    for (U i = 0; i < count; ++i) run_case(input.get(), output.get(), benchmark);
    if (fgetc(input.get()) != EOF || ferror(input.get())) throw std::runtime_error("trailing CUDA request data");
    if (fclose(output.release())) throw std::runtime_error("cannot close CUDA response");
    return 0;
  } catch (const std::exception& error) {
    fprintf(stderr, "%s\n", error.what());
    return 1;
  }
}
`;
var benchmarkFlag = '    const bool benchmark = argc == 2 && strcmp(argv[1], "--benchmark") == 0;\n';
var gatedMain = main.replace(
  benchmarkFlag,
  String.raw`    bool benchmark = false;
    for (int a = 1; a < argc; ++a) {
      if (!strcmp(argv[a], "--benchmark")) benchmark = true;
      else if (!strcmp(argv[a], "--gate=fused")) gate_mode = 1;
      else if (!strcmp(argv[a], "--gate=unfused")) gate_mode = 2;
      else throw std::runtime_error("unknown argument");
    }
`
);
if (gatedMain === main) throw Error("The CUDA main no longer has the benchmark flag line");
var gateSupport = "\nstatic int gate_mode = 0;";
function affine(a, name2) {
  const terms = a.terms.map(
    ([key, coefficient]) => coefficient === 1 ? name2(key) : `${coefficient}LL * ${name2(key)}`
  );
  if (a.constant || !terms.length) terms.unshift(`${a.constant}LL`);
  return `(${terms.join(" + ")})`;
}
function literal(text2) {
  const bytes = new DataView(new ArrayBuffer(4));
  bytes.setFloat32(0, Number(text2));
  return `__uint_as_float(0x${bytes.getUint32(0).toString(16)}u)`;
}
function kernelWriter(dimensions, load, maxFold = "minmax(ACC, VALUE, true)", stagedTerms = () => void 0) {
  const lines = [];
  let indent = "  ", next = 0;
  const line = (code) => lines.push(indent + code);
  const dim = (a) => affine(a, (n) => dimensions.get(n));
  const indices = /* @__PURE__ */ new Map();
  const bind = (id) => {
    const name2 = `i${indices.size}`;
    indices.set(id, name2);
    return name2;
  };
  const index = (id) => indices.get(id);
  const offset = (at, shape) => at.reduce(
    (prior, a, i) => i ? `(${prior} * ${dim(shape[i])} + ${affine(a, index)})` : affine(a, index),
    ""
  );
  const bound = (extent) => {
    const n = dim(extent.dim);
    if (extent.kind === "blocks")
      return `${n} / ${width}${extent.rounding === "ceil" ? ` + (${n} % ${width} != 0)` : ""}`;
    if (extent.kind === "tail") {
      const remaining = `(${n} - ${width}LL * ${index(extent.block)})`;
      return `(${remaining} < ${width}LL ? ${remaining} : ${width}LL)`;
    }
    return n;
  };
  const temporary = (code) => {
    const name2 = `v${next++}`;
    line(`float ${name2} = ${code};`);
    return name2;
  };
  function scalar(e) {
    switch (e.kind) {
      case "literal":
        return literal(e.text);
      case "shape":
        return `__ll2float_rn(${dimensions.get(e.name)})`;
      case "load":
        return load(e, offset);
      case "op": {
        const [a, b] = e.args.map(scalar);
        switch (e.op) {
          case "+":
            return temporary(`__fadd_rn(${a}, ${b})`);
          case "-":
            return temporary(`__fsub_rn(${a}, ${b})`);
          case "*":
            return temporary(`__fmul_rn(${a}, ${b})`);
          case "/":
            return temporary(`__fdiv_rn(${a}, ${b})`);
          case "neg":
            return temporary(`-(${a})`);
          case "sqrt":
            return temporary(`__fsqrt_rn(${a})`);
          case "exp":
          case "log":
          case "tanh":
            return temporary(`__double2float_rn(${e.op}(static_cast<double>(${a})))`);
          case "max":
          case "min":
            return temporary(`minmax(${a}, ${b}, ${e.op === "max"})`);
        }
      }
      case "reduce": {
        const acc = temporary(e.op === "sum" ? "0.0f" : "-INFINITY");
        const step = (value) => line(
          `${acc} = ${e.op === "sum" ? `__fadd_rn(${acc}, ${value})` : maxFold.replace("ACC", acc).replace("VALUE", value)};`
        );
        const ready = stagedTerms(e);
        if (ready) {
          line(`for (U t = 0; t < ${ready.count}; ++t) {`);
          indent += "  ";
          step(`${ready.terms}[t]`);
          indent = indent.slice(2);
          line("}");
          return acc;
        }
        for (const { id, extent } of e.axes) {
          const axis = bind(id);
          line(`const I end_${axis} = ${bound(extent)};`);
          line(`for (I ${axis} = 0; ${axis} < end_${axis}; ++${axis}) {`);
          indent += "  ";
        }
        step(scalar(e.body));
        for (const _axis of e.axes) {
          indent = indent.slice(2);
          line("}");
        }
        return acc;
      }
    }
  }
  return {
    lines,
    line,
    dim,
    bound,
    bind,
    alias: (id, name2) => void indices.set(id, name2),
    scalar,
    enter: () => void (indent += "  "),
    leave: () => void (indent = indent.slice(2))
  };
}
function elementOfThread(w, statement, target) {
  w.line("U coordinate = thread;");
  for (let i = statement.axes.length - 1; i >= 0; --i) {
    const axis = w.bind(statement.axes[i].id);
    w.line(`const I ${axis} = coordinate % ${w.dim(statement.shape[i])};`);
    if (i > 0) w.line(`coordinate /= ${w.dim(statement.shape[i])};`);
  }
  const result = w.scalar(statement.expr);
  w.line(`${target}[thread] = ${result};`);
}
function emitKernel(statement, kernel, dimensions, tensors, tensorName) {
  const reads = /* @__PURE__ */ new Set();
  visit(statement.expr, (e) => {
    if (e.kind === "load") reads.add(e.name);
  });
  const args = [...dimensions.values(), ...Array.from(reads, tensorName), tensorName(statement.name)];
  const params = [
    ...Array.from(dimensions.values(), (d) => `I ${d}`),
    ...Array.from(reads, (t) => `const float* ${tensorName(t)}`),
    "float* result",
    "U count"
  ];
  const w = kernelWriter(
    dimensions,
    (e, offset) => `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name).shape)}]`
  );
  w.lines.push(`__global__ void ${kernel}(${params.join(", ")}) {`);
  w.line("const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;");
  w.line("if (thread >= count) return;");
  elementOfThread(w, statement, "result");
  w.lines.push("}");
  const count = `${tensorName(statement.name)}.size`;
  return {
    code: w.lines.join("\n"),
    host: [],
    preload: `  if (${count}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork: count,
    launch: `    if (${count}) {
      ${kernel}<<<(${count} - 1) / 256 + 1, 256>>>(${args.map((arg, i) => i < dimensions.size ? arg : arg + ".ptr").join(", ")}, ${count});
      check(cudaGetLastError());
    }`
  };
}
var fusedSupport = String.raw`
__device__ static float max_nan(float a, float b) {
  float r;
  asm("max.NaN.f32 %0, %1, %2;" : "=f"(r) : "f"(a), "f"(b));
  return r;
}`;
var blockThreads = { rows: 128, contraction: 64, heavy: 256 };
var defaultShared = 48 * 1024;
var product = (dims) => dims.length ? `(${dims.map((d) => `static_cast<U>(${d})`).join(" * ")})` : "static_cast<U>(1)";
function emitGroup(group, dimensions, tensors, tensorName) {
  const { kernel, depth } = group;
  const members = group.statements.map((n) => tensors.get(n));
  const inGroup = new Set(group.statements), stored = new Set(group.stored), staged = new Set(group.staged);
  const block = group.mapping === "block";
  const reads = /* @__PURE__ */ new Set();
  for (const m of members)
    visit(m.expr, (e) => {
      if (e.kind === "load" && !inGroup.has(e.name)) reads.add(e.name);
    });
  const outputs = members.filter((m) => block || stored.has(m.name)).map((m) => tensorName(m.name));
  const params = [
    ...Array.from(dimensions.values(), (d) => `I ${d}`),
    ...Array.from(reads, (t) => `const float* ${tensorName(t)}`),
    ...outputs.map((t) => `float* ${t}`),
    ...block ? ["float* scratch"] : [],
    "U count"
  ];
  const suffix = (name2) => tensorName(name2).slice(1);
  const rowBuffers = [...group.staged, ...group.buffered];
  const registers = /* @__PURE__ */ new Map();
  let current = members[0];
  const operands = (e, inReduction) => e.kind === "load" ? inReduction && !rowBuffers.includes(e.name) : e.kind === "op" ? e.args.some((a) => operands(a, inReduction)) : e.kind === "reduce" && operands(e.body, true);
  const cap = members.some((m) => operands(m.expr, false)) ? blockThreads.contraction : blockThreads.rows;
  const termIds = /* @__PURE__ */ new Map();
  const memberTerms = members.map((m) => {
    const outer = outerReductions(m.expr);
    return group.terms.filter((t) => t.statement === m.name).map((t) => {
      termIds.set(outer[t.reduction], `${suffix(m.name)}_${t.reduction}`);
      return outer[t.reduction];
    });
  });
  const w = kernelWriter(
    dimensions,
    (e, offset) => {
      const shape = tensors.get(e.name).shape;
      if (!block && inGroup.has(e.name)) return registers.get(e.name);
      const ownRow = e.indices.slice(0, depth).every((a, p) => plain(a) === current.axes[p].id);
      if (block && rowBuffers.includes(e.name) && ownRow)
        return `r${suffix(e.name)}[${offset(e.indices.slice(depth), shape.slice(depth)) || "0"}]`;
      if (inGroup.has(e.name)) throw Error(`Fused read of ${e.name} outside its row`);
      return `${tensorName(e.name)}[${offset(e.indices, shape)}]`;
    },
    "max_nan(ACC, VALUE)",
    (e) => termIds.has(e) ? { count: `c${termIds.get(e)}`, terms: `q${termIds.get(e)}` } : void 0
  );
  w.lines.push(`// ${kernel}: ${group.statements.join(", ")}; ${group.reasons.join("; ")}`);
  if (block) w.lines.push("template <int Mode>");
  w.lines.push(`__global__ void ${kernel}(${params.join(", ")}) {`);
  if (block) {
    w.line("if (Mode >= 2) {");
    w.line("  const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;");
    w.line("  if (thread >= count) return;");
    members.forEach((m, j) => {
      const alone = kernelWriter(
        dimensions,
        (e, offset) => `${tensorName(e.name)}[${offset(e.indices, tensors.get(e.name).shape)}]`
      );
      elementOfThread(alone, m, tensorName(m.name));
      w.line(`  if (Mode == ${2 + j}) {`);
      w.lines.push(...alone.lines.map((l) => "    " + l));
      w.line("  }");
    });
    w.line("  return;");
    w.line("}");
    w.line("constexpr bool Shared = Mode == 1;");
  }
  const first = members[0];
  const counter = block ? "point" : "thread";
  if (block) {
    w.line("extern __shared__ float shared[];");
    w.line("const U point = blockIdx.x;");
  } else {
    w.line("const U thread = static_cast<U>(blockIdx.x) * blockDim.x + threadIdx.x;");
    w.line("if (thread >= count) return;");
  }
  w.line(`U coordinate = ${counter};`);
  for (let p = depth - 1; p >= 0; --p) {
    const axis = w.bind(first.axes[p].id);
    w.line(`const I ${axis} = coordinate % ${w.dim(first.shape[p])};`);
    if (p > 0) w.line(`coordinate /= ${w.dim(first.shape[p])};`);
    for (const m of members.slice(1)) w.alias(m.axes[p].id, axis);
  }
  const lengthOf = (name2, dim) => product(tensors.get(name2).shape.slice(depth).map(dim));
  const host = [];
  let hasWork;
  if (block) {
    for (const name2 of /* @__PURE__ */ new Set([...group.staged, ...group.statements]))
      w.line(`const U n${suffix(name2)} = ${lengthOf(name2, w.dim)};`);
    const count = (r) => product(r.axes.map((a) => `(${w.bound(a.extent)} > 0 ? ${w.bound(a.extent)} : 0)`));
    const staging2 = memberTerms.filter((rs) => rs.length);
    for (const r of staging2.flat()) w.line(`const U c${termIds.get(r)} = ${count(r)};`);
    const area = (c) => (
      // (a ternary: std::max is not callable in device code, probe in diary step 2)
      staging2.map((rs) => rs.map(c).join(" + ")).reduce((a, b) => a ? `((${a}) > (${b}) ? (${a}) : (${b}))` : b, "")
    );
    const over = new Map(group.inPlace.map((p) => [p.statement, p.over]));
    const owners = rowBuffers.filter((n) => !over.has(n));
    const row = [
      ...owners.map((n) => `n${suffix(n)}`),
      ...staging2.length ? [area((r) => `c${termIds.get(r)}`)] : []
    ].join(" + ");
    w.line(`float* const base = Shared ? shared : scratch + point * (${row});`);
    for (const name2 of rowBuffers) {
      const i = owners.indexOf(name2);
      const at = over.has(name2) ? `r${suffix(over.get(name2))}` : i ? `r${suffix(owners[i - 1])} + n${suffix(owners[i - 1])}` : "base";
      w.line(`float* const r${suffix(name2)} = ${at};`);
    }
    const last = owners.at(-1);
    if (staging2.length)
      w.line(`float* const terms = ${last ? `r${suffix(last)} + n${suffix(last)}` : "base"};`);
    for (const name2 of group.staged) {
      const s = suffix(name2);
      w.line(`for (U e = threadIdx.x; e < n${s}; e += blockDim.x) r${s}[e] = t${s}[point * n${s} + e];`);
    }
    if (group.staged.length) w.line("__syncthreads();");
    members.forEach((m, j) => {
      current = m;
      const s = suffix(m.name);
      memberTerms[j].forEach((r, q) => {
        const id = termIds.get(r);
        const before = memberTerms[j].slice(0, q).map((x) => ` + c${termIds.get(x)}`);
        w.line(`float* const q${id} = terms${before.join("")};`);
        w.line(`for (U e = threadIdx.x; e < c${id}; e += blockDim.x) {`);
        w.enter();
        if (r.axes.length > 1) w.line("U rest = e;");
        for (let a = r.axes.length - 1; a >= 0; --a) {
          const axis = w.bind(r.axes[a].id);
          w.line(`const I ${axis} = ${r.axes.length > 1 ? "rest" : "e"} % (${w.bound(r.axes[a].extent)});`);
          if (a > 0) w.line(`rest /= (${w.bound(r.axes[a].extent)});`);
        }
        const term = w.scalar(r.body);
        w.line(`q${id}[e] = ${term};`);
        w.leave();
        w.line("}");
      });
      if (memberTerms[j].length) w.line("__syncthreads();");
      w.line(`for (U e = threadIdx.x; e < n${s}; e += blockDim.x) {`);
      w.enter();
      if (m.axes.length > depth) w.line("U rest = e;");
      for (let p = m.axes.length - 1; p >= depth; --p) {
        const axis = w.bind(m.axes[p].id);
        w.line(`const I ${axis} = rest % ${w.dim(m.shape[p])};`);
        if (p > depth) w.line(`rest /= ${w.dim(m.shape[p])};`);
      }
      const value = w.scalar(m.expr);
      if (group.buffered.includes(m.name)) w.line(`r${s}[e] = ${value};`);
      if (stored.has(m.name)) w.line(`t${s}[point * n${s} + e] = ${value};`);
      w.leave();
      w.line("}");
      if (j < members.length - 1) w.line("__syncthreads();");
    });
    const hostDim = (a) => affine(a, (n) => dimensions.get(n));
    const lengths = [.../* @__PURE__ */ new Set([...group.staged, ...group.statements])].map((n) => lengthOf(n, hostDim));
    lengths.push(...staging2.flat().map(count));
    const hostRow = [...owners.map((n) => lengthOf(n, hostDim)), ...staging2.length ? [area(count)] : []].join(
      " + "
    );
    host.push(
      `  const U grid_${kernel} = ${product(first.shape.slice(0, depth).map(hostDim))};`,
      `  const U row_${kernel} = (${hostRow}) * sizeof(float);`,
      `  const bool shared_${kernel} = row_${kernel} <= static_cast<U>(shared_limit);`,
      `  const U longest_${kernel} = std::max<U>({${lengths.join(", ")}, static_cast<U>(1)});`,
      group.heavy.length ? `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${blockThreads.heavy}, (std::max<U>(std::min<U>({${group.heavy.map((n) => lengthOf(n, hostDim)).join(", ")}}), 1) + 31) / 32 * 32));` : `  const unsigned threads_${kernel} = static_cast<unsigned>(std::min<U>(${cap}, (longest_${kernel} + 31) / 32 * 32));`,
      // The gate: block mode, or the members one by one. --gate=fused|unfused forces a side (the contract).
      // Blocks of this kernel that fit on one SM, by its block, thread and shared-memory limits (each block's
      // shared memory includes the device's reserved part: 1 KiB on the GB10).
      `  const U resident_${kernel} = std::min<U>({sm_blocks, sm_threads / threads_${kernel}, shared_${kernel} ? sm_shared / (row_${kernel} + sm_reserved) : sm_blocks});`,
      `  const bool fused_${kernel} = gate_mode ? gate_mode == 1 : ${gateRule({
        grid: `grid_${kernel}`,
        longest: `longest_${kernel}`,
        lanes: group.heavy.map(
          (n) => `resident_${kernel} * std::min<U>(threads_${kernel}, ${lengthOf(n, hostDim)})`
        ),
        slots: "sm_threads"
      })};`,
      `  DeviceBuffer scratch_${kernel}(fused_${kernel} && !shared_${kernel} ? grid_${kernel} * (row_${kernel} / sizeof(float)) : 0);`,
      ...members.filter((m) => !stored.has(m.name)).map(
        (m) => `  DeviceBuffer ${tensorName(m.name)}(fused_${kernel} ? 0 : elements(shape_${tensorName(m.name)}));`
      )
    );
    hasWork = `grid_${kernel}`;
  } else {
    for (const m of members) {
      current = m;
      const value = w.scalar(m.expr);
      registers.set(m.name, value);
      if (stored.has(m.name)) w.line(`${tensorName(m.name)}[thread] = ${value};`);
    }
    host.push(`  const U count_${kernel} = elements(shape_${tensorName(first.name)});`);
    hasWork = `count_${kernel}`;
  }
  w.lines.push("}");
  const args = [
    ...dimensions.values(),
    ...Array.from(reads, (t) => tensorName(t) + ".ptr"),
    ...outputs.map((t) => t + ".ptr"),
    ...block ? [`scratch_${kernel}.ptr`] : [`count_${kernel}`]
  ];
  const optIn = `shared_${kernel} && row_${kernel} > ${defaultShared}`;
  const size = (m) => `elements(shape_${tensorName(m.name)})`;
  const blockArgs = [...args, "0"].join(", ");
  return {
    code: w.lines.join("\n"),
    host,
    preload: block ? `  if (grid_${kernel} && fused_${kernel}) {
    check(cudaFuncGetAttributes(&attributes, shared_${kernel} ? ${kernel}<1> : ${kernel}<0>));
    if (${optIn}) check(cudaFuncSetAttribute(${kernel}<1>, cudaFuncAttributeMaxDynamicSharedMemorySize, static_cast<int>(row_${kernel})));
  }
  if (grid_${kernel} && !fused_${kernel}) {
${members.map((_m, j) => `    check(cudaFuncGetAttributes(&attributes, ${kernel}<${2 + j}>));`).join("\n")}
  }` : `  if (count_${kernel}) check(cudaFuncGetAttributes(&attributes, ${kernel}));`,
    hasWork,
    launch: block ? `    if (grid_${kernel} && fused_${kernel} && shared_${kernel}) ${kernel}<1><<<static_cast<unsigned>(grid_${kernel}), threads_${kernel}, row_${kernel}>>>(${blockArgs});
    if (grid_${kernel} && fused_${kernel} && !shared_${kernel}) ${kernel}<0><<<static_cast<unsigned>(grid_${kernel}), threads_${kernel}>>>(${blockArgs});
${members.map(
      (m, j) => `    if (!fused_${kernel} && ${size(m)}) ${kernel}<${2 + j}><<<(${size(m)} - 1) / 256 + 1, 256>>>(${[...args, size(m)].join(", ")});`
    ).join("\n")}
    if (grid_${kernel}) check(cudaGetLastError());` : `    if (count_${kernel}) {
      ${kernel}<<<(count_${kernel} - 1) / 256 + 1, 256>>>(${args.join(", ")});
      check(cudaGetLastError());
    }`
  };
}
function emitCuda(fn, plan = unfusedPlan(fn)) {
  const all = [...fn.params, ...fn.statements];
  const tensors = new Map(all.map((t) => [t.name, t]));
  const names = new Map(all.map((t, i) => [t.name, `t${i}`]));
  const name2 = (key) => names.get(key);
  const dims = /* @__PURE__ */ new Map(), bindings = [];
  for (const p of fn.params) {
    for (const [i, a] of p.shape.entries()) {
      const key = plain(a);
      if (key === void 0 || dims.has(key)) continue;
      const d = `d${dims.size}`;
      dims.set(key, d);
      bindings.push(`  const I ${d} = shape_${name2(p.name)}[${i}];`);
    }
  }
  const kernels = plan.groups.map(
    (g) => g.statements.length === 1 ? emitKernel(tensors.get(g.statements[0]), g.kernel, dims, tensors, name2) : emitGroup(g, dims, tensors, name2)
  );
  const stored = new Set(plan.groups.flatMap((g) => g.stored));
  const host = ["static void run_case(FILE* input, FILE* output, bool benchmark) {"];
  for (const p of fn.params) {
    const t = name2(p.name);
    host.push(
      `  std::array<I, ${p.shape.length}> shape_${t};`,
      `  read(input, shape_${t}.data(), shape_${t}.size());`,
      `  std::vector<float> host_${t}(elements(shape_${t}));`,
      `  read(input, host_${t}.data(), host_${t}.size());`
    );
  }
  const result = name2(fn.result);
  let buffer = `host_${result}`;
  host.push("  double gpu_ms = 0;");
  if (kernels.length) {
    host.push(...bindings);
    for (const p of fn.params) {
      const t = name2(p.name);
      host.push(`  DeviceBuffer ${t}(host_${t}.size());`, `  ${t}.upload(host_${t}.data());`);
    }
    for (const s of fn.statements) {
      const t = name2(s.name);
      const dimsText = s.shape.map((a) => affine(a, (key) => dims.get(key))).join(", ");
      host.push(`  const std::array<I, ${s.shape.length}> shape_${t}{${dimsText}};`);
      if (stored.has(s.name)) host.push(`  DeviceBuffer ${t}(elements(shape_${t}));`);
    }
    if (plan.groups.some((g) => g.mapping === "block"))
      host.push(
        "  int shared_limit = 0, sm_shared_bytes = 0, sm_block_limit = 0, reserved_bytes = 0;",
        "  check(cudaDeviceGetAttribute(&reserved_bytes, cudaDevAttrReservedSharedMemoryPerBlock, 0));",
        "  check(cudaDeviceGetAttribute(&shared_limit, cudaDevAttrMaxSharedMemoryPerBlockOptin, 0));",
        // The SM's limits, for the gate (the calls of IRWB-029-D probe 01).
        "  check(cudaDeviceGetAttribute(&sm_shared_bytes, cudaDevAttrMaxSharedMemoryPerMultiprocessor, 0));",
        "  check(cudaDeviceGetAttribute(&sm_block_limit, cudaDevAttrMaxBlocksPerMultiprocessor, 0));",
        "  cudaDeviceProp device;",
        "  check(cudaGetDeviceProperties(&device, 0));",
        "  const U sm_shared = sm_shared_bytes, sm_blocks = sm_block_limit, sm_threads = device.maxThreadsPerMultiProcessor;",
        "  const U sm_reserved = std::max(reserved_bytes, 1);"
      );
    host.push(
      ...kernels.flatMap((k) => k.host),
      "  cudaFuncAttributes attributes;",
      ...kernels.map((k) => k.preload),
      `  if (${kernels.map((k) => k.hasWork).join(" || ")}) gpu_ms = time_kernels([&] {`,
      ...kernels.map((k) => k.launch),
      "  }, benchmark);"
    );
    if (fn.statements.some((s) => s.name === fn.result)) {
      buffer = `host_${result}`;
      host.push(`  std::vector<float> ${buffer}(${result}.size);`, `  ${result}.download(${buffer}.data());`);
    }
  }
  host.push(
    `  write(output, shape_${result}.data(), shape_${result}.size());`,
    `  write(output, ${buffer}.data(), ${buffer}.size());`,
    "  write(output, &gpu_ms, 1);",
    ...plan.groups.filter((g) => g.statements.length > 1 && g.mapping === "block").map((g) => `  { const unsigned char choice = fused_${g.kernel} ? 1 : 0; write(output, &choice, 1); }`),
    "}"
  );
  const fused = plan.groups.some((g) => g.statements.length > 1) ? [fusedSupport] : [];
  const gated = plan.groups.some((g) => g.statements.length > 1 && g.mapping === "block");
  if (gated) fused.push(gateSupport);
  return [support, ...fused, ...kernels.map((k) => k.code), host.join("\n"), gated ? gatedMain : main].join(
    "\n\n"
  );
}

// parser.ts
function fail(t, message) {
  throw Error(`${t.line}:${t.col} ${message}`);
}
var number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
var name = /^[A-Za-z_]\w*$/;
function lex(source) {
  const tokens = [];
  const parts = /\/\/[^\r\n]*|\r\n|[\r\n]|[^\S\r\n]+|[A-Za-z_]\w*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|./gy;
  let line = 1, col = 1;
  for (const [text2] of source.matchAll(parts)) {
    if (text2 === "\n" || text2 === "\r" || text2 === "\r\n") {
      line++;
      col = 1;
      continue;
    }
    if (!/^\s|^\/\//.test(text2)) tokens.push({ text: text2, line, col });
    col += text2.length;
  }
  return [...tokens, { text: "<end>", line, col }];
}
function checkBounds({ index, extent, token, binders }) {
  if ([...binders.values()].some((b) => b.dim && !b.dim.terms.length && b.dim.constant === 0)) return;
  let lo = constant(index.constant), hi = constant(index.constant), excess;
  try {
    for (const [id, k] of index.terms) {
      const last = add(binders.get(id).dim, constant(-1));
      if (k < 0) lo = add(lo, last, k);
      else hi = add(hi, last, k);
    }
    excess = add(hi, extent, -1);
  } catch (error) {
    fail(token, error.message);
  }
  if (!lo.terms.length && lo.constant < 0 || !excess.terms.length && excess.constant >= 0)
    fail(token, "Index outside axis");
}
function parse(source) {
  return new Parser(lex(source)).program();
}
var Parser = class {
  constructor(tokens) {
    this.tokens = tokens;
  }
  pos = 0;
  nextId = 0;
  tensors = /* @__PURE__ */ new Map();
  symbols = /* @__PURE__ */ new Set();
  scope = /* @__PURE__ */ new Map();
  // Extents can be inferred by a later read in the same RHS.
  accesses = [];
  get t() {
    return this.tokens[this.pos];
  }
  take(s) {
    if (this.t.text !== s) return false;
    this.pos++;
    return true;
  }
  expect(s) {
    if (!this.take(s)) fail(this.t, `Expected ${s}`);
  }
  ident() {
    const t = this.t;
    if (!name.test(t.text)) fail(t, "Expected name");
    this.pos++;
    return t;
  }
  list(read) {
    const out = [read()];
    while (this.take(",")) out.push(read());
    return out;
  }
  program() {
    const functions = [];
    do {
      const t = this.t;
      const fn = this.fn();
      if (functions.some((f) => f.name === fn.name)) fail(t, "Duplicate function");
      functions.push(fn);
    } while (this.t.text !== "<end>");
    return { functions };
  }
  affine(index, min = 0) {
    const start = this.t;
    let a;
    if (this.take("-")) a = add(constant(0), this.affine(index, 3), -1);
    else if (this.take("(")) {
      a = this.affine(index);
      this.expect(")");
    } else if (/^\d+$/.test(start.text)) {
      this.pos++;
      a = constant(Number(start.text));
      if (!Number.isSafeInteger(a.constant)) fail(start, "Invalid integer");
    } else {
      const n = this.ident();
      const binder = this.scope.get(n.text);
      if (index && !binder) fail(n, "Unknown index");
      a = variable(index ? binder.id : n.text);
    }
    while (true) {
      const op = this.t, prec = op.text === "*" ? 2 : ["+", "-"].includes(op.text) ? 1 : 0;
      if (prec <= min) break;
      this.pos++;
      const b = this.affine(index, prec);
      try {
        if (op.text === "*") {
          if (a.terms.length && b.terms.length) fail(op, "Non-affine product");
          a = a.terms.length ? add(constant(0), a, b.constant) : add(constant(0), b, a.constant);
        } else a = add(a, b, op.text === "+" ? 1 : -1);
      } catch (error) {
        fail(op, error.message);
      }
    }
    return a;
  }
  type(input = false) {
    this.expect("f32");
    this.expect("[");
    const dims = this.list(() => {
      const t = this.t, d = this.affine(false);
      if (!d.terms.length && d.constant < 0) fail(t, "Negative dimension");
      if (!input) {
        for (const [n] of d.terms) if (!this.symbols.has(n)) fail(t, "Unbound shape " + n);
      }
      return d;
    });
    this.expect("]");
    return dims;
  }
  fn() {
    this.tensors.clear();
    this.symbols.clear();
    this.nextId = 0;
    this.expect("fn");
    const fn = this.ident().text;
    this.expect("(");
    const positions = [];
    const params = this.list(() => {
      const n = this.ident();
      positions.push(n);
      if (this.tensors.has(n.text)) fail(n, "Duplicate parameter");
      this.expect(":");
      const p = { name: n.text, shape: this.type(true) };
      this.tensors.set(p.name, p);
      return p;
    });
    for (const p of params)
      for (const d of p.shape) {
        const n = plain(d);
        if (n) this.symbols.add(n);
      }
    params.forEach((p, i) => {
      for (const d of p.shape)
        for (const [n] of d.terms) if (!this.symbols.has(n)) fail(positions[i], "No input axis binds " + n);
    });
    this.expect(")");
    this.expect(":");
    const shape = this.type();
    this.expect("{");
    const statements = [];
    while (!this.take("return")) statements.push(this.statement());
    const result = this.ident(), tensor = this.tensors.get(result.text);
    if (!tensor || JSON.stringify(tensor.shape) !== JSON.stringify(shape))
      fail(result, "Invalid return tensor or shape");
    this.expect(";");
    this.expect("}");
    return { name: fn, params, statements, result: result.text, shape };
  }
  binders() {
    const seen = /* @__PURE__ */ new Set();
    return this.list(() => {
      const token = this.ident();
      if (seen.has(token.text)) fail(token, "Duplicate binder");
      seen.add(token.text);
      const b = { token, id: "i" + this.nextId++ };
      this.scope.set(token.text, b);
      return b;
    });
  }
  axes(binders) {
    return binders.map((b) => ({
      id: b.id,
      extent: { kind: "dim", dim: b.dim ?? fail(b.token, "Cannot infer extent") }
    }));
  }
  statement() {
    this.scope.clear();
    this.accesses = [];
    const t = this.ident();
    if (this.tensors.has(t.text)) fail(t, "Tensor already assigned");
    this.expect("[");
    const binders = this.binders();
    this.expect("]");
    if (this.take(":")) {
      const dims = this.type();
      if (dims.length !== binders.length) fail(t, "Declared rank mismatch");
      binders.forEach((b, i) => b.dim = dims[i]);
    }
    this.expect("=");
    const expr = this.expr();
    this.expect(";");
    const axes = this.axes(binders), shape = binders.map((b) => b.dim);
    this.accesses.forEach(checkBounds);
    const s = { name: t.text, shape, axes, expr };
    this.tensors.set(s.name, s);
    return s;
  }
  expr(min = 0) {
    let e = this.primary();
    while (true) {
      const op = this.t.text, prec = ["+", "-"].includes(op) ? 1 : ["*", "/"].includes(op) ? 2 : 0;
      if (prec <= min) return e;
      this.pos++;
      e = { kind: "op", op, args: [e, this.expr(prec)] };
    }
  }
  maxBinderList() {
    let i = this.pos, names = [];
    while (name.test(this.tokens[i].text)) {
      names.push(this.tokens[i++].text);
      if (this.tokens[i].text !== ",") break;
      i++;
    }
    if (this.tokens[i].text !== ")") return false;
    const next = this.tokens[i + 1]?.text ?? "";
    return (next === "(" || next === "-" || name.test(next) || number.test(next)) && !(next === "-" && names.length === 2 && names.every((n) => this.symbols.has(n)));
  }
  primary() {
    const t = this.t;
    if (this.take("-")) return { kind: "op", op: "neg", args: [this.expr(2)] };
    if (this.take("(")) {
      const e = this.expr();
      this.expect(")");
      return e;
    }
    if (number.test(t.text)) {
      this.pos++;
      return { kind: "literal", text: t.text };
    }
    const n = this.ident().text;
    if (this.take("[")) {
      const tensor = this.tensors.get(n);
      if (!tensor) fail(t, "Unknown tensor " + n);
      let axis = 0;
      const indices = this.list(() => {
        const start = this.pos, tok = this.t, a = this.affine(true);
        const d = tensor.shape[axis++];
        if (!d) fail(tok, "Too many axes");
        if (this.pos === start + 1 && name.test(tok.text)) {
          const b = this.scope.get(tok.text);
          if (b.dim && JSON.stringify(b.dim) !== JSON.stringify(d)) fail(tok, "Inconsistent extent");
          b.dim = d;
        }
        const binders = new Map([...this.scope.values()].map((b) => [b.id, b]));
        this.accesses.push({ index: a, extent: d, token: tok, binders });
        return a;
      });
      this.expect("]");
      if (indices.length !== tensor.shape.length) fail(t, "Wrong reference rank");
      return { kind: "load", name: n, indices };
    }
    if (this.take("(")) {
      if (n === "sum" || n === "max" && this.maxBinderList()) {
        const outer = this.scope;
        this.scope = new Map(outer);
        const binders = this.binders();
        this.expect(")");
        const body = this.expr(), axes = this.axes(binders);
        this.scope = outer;
        return { kind: "reduce", op: n, axes, body };
      }
      const args = this.list(() => this.expr());
      this.expect(")");
      const arity = ["exp", "log", "sqrt", "tanh"].includes(n) ? 1 : ["max", "min"].includes(n) ? 2 : 0;
      if (!arity || args.length !== arity) fail(t, "Invalid intrinsic call");
      return { kind: "op", op: n, args };
    }
    if (!this.symbols.has(n)) fail(t, "Unknown shape " + n);
    return { kind: "shape", name: n };
  }
};

// entry.mjs
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
var root = "/home/manuel/code/wesen/2026-11-24--compiler-workbench/.claude/worktrees/t6-g-h-irwb-033-f/corpus/tensor/";
for (const name2 of ["matmul", "softmax", "layernorm", "attention", "mlp", "conv2d"]) {
  const f = parse(readFileSync(root + name2 + "/main.tix", "utf8")).functions[0];
  const source = emitCuda(f, planFusion(f));
  console.log(JSON.stringify({ name: name2, sha: createHash("sha256").update(source).digest("hex") }));
}
