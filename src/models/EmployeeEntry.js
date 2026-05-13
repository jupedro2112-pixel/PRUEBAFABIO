/**
 * Empleados por sector (ganamos / publicidad / buffalo) y por puesto.
 *
 * Cada empleado tiene un sueldo base mensual y opcionalmente pagos extra
 * por feriados trabajados. El total mensual se calcula como:
 *   totalMensual = sueldoARS + Σ feriados[i].amountARS
 *
 * Los puestos (roles) son strings libres — los defaults son encargados,
 * pagos, comunidad, cargas, recontactacion, revision_chat, pero el owner
 * puede tipear cualquier otro nombre.
 */
const mongoose = require('mongoose');

const feriadoSchema = new mongoose.Schema({
  dateKey: { type: String, default: '' }, // YYYY-MM-DD del feriado
  amountARS: { type: Number, default: 0, min: 0 },
  note: { type: String, default: '', maxlength: 200 }
}, { _id: false });

const employeeSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },

  // Estructura financiera a la que pertenece. Coincide con los sectores
  // de cierres para que sea fácil consolidar números totales.
  sector: {
    type: String,
    enum: ['ganamos', 'publicidad', 'buffalo'],
    required: true,
    index: true
  },

  // Puesto / rol dentro del sector. String libre — los defaults sugeridos:
  //   encargados, pagos, comunidad, cargas, recontactacion, revision_chat
  // Se guarda en minúscula sin espacios al final/principio.
  role: { type: String, required: true, trim: true, maxlength: 60, index: true },

  // Datos del empleado
  name: { type: String, default: '', trim: true, maxlength: 100 },
  schedule: { type: String, default: '', trim: true, maxlength: 200 },
  sueldoARS: { type: Number, default: 0, min: 0 },

  // Pagos extra por feriados trabajados en el mes
  feriados: { type: [feriadoSchema], default: [] },

  notes: { type: String, default: '', maxlength: 500 },
  active: { type: Boolean, default: true, index: true },

  createdBy: { type: String, default: '' }
}, { timestamps: true });

employeeSchema.index({ sector: 1, role: 1, name: 1 });

module.exports = mongoose.models['EmployeeEntry'] ||
  mongoose.model('EmployeeEntry', employeeSchema);
