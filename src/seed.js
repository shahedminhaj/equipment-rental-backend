const bcrypt = require("bcryptjs");
const config = require("./config");

const DEMO_OWNER_EMAIL = "owner@fieldkit.demo";

const SAMPLE_EQUIPMENT = [
  {
    name: "CAT 305 Mini Excavator",
    description: "Compact excavator for tight urban sites, trenching, and landscaping. Delivered with a trained operator on request.",
    category: "Construction Equipment",
    location: "Dhaka",
    price: 12500,
    rentalType: "Daily",
    availableQuantity: 3,
    condition: "Excellent",
    brand: "Caterpillar",
    model: "305E2 CR",
    image: "https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=1200&q=85",
    tags: ["excavator", "construction", "operator available"],
    rentalTerms: ["Valid driving licence required for self-drive", "Fuel is charged separately", "Minimum one-day rental"],
  },
  {
    name: "Sony FX3 Cinema Camera Kit",
    description: "Full-frame cinema camera with two lenses, tripod, and onboard monitoring. Perfect for weddings and commercial shoots.",
    category: "Photography Equipment",
    location: "Dhaka",
    price: 4800,
    rentalType: "Daily",
    availableQuantity: 2,
    condition: "Excellent",
    brand: "Sony",
    model: "FX3",
    image: "https://images.unsplash.com/photo-1516035069371-29a1b244cc32?auto=format&fit=crop&w=1200&q=85",
    tags: ["camera", "cinema", "lenses included"],
    rentalTerms: ["Refundable security deposit required", "Handle with care; scratches are chargeable", "Return with charged batteries"],
  },
  {
    name: "Toyota HiAce Van",
    description: "Spacious 12-seater van for airport transfers, family trips, and equipment transport. Chauffeur optional.",
    category: "Vehicles & Transportation",
    location: "Chattogram",
    price: 6500,
    rentalType: "Daily",
    availableQuantity: 2,
    condition: "Good",
    brand: "Toyota",
    model: "HiAce",
    image: "https://images.unsplash.com/photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1200&q=85",
    tags: ["van", "transport", "chauffeur optional"],
    rentalTerms: ["Driving licence required", "Toll and fuel excluded", "300 km per day limit"],
  },
  {
    name: "Kubota L3901 Tractor",
    description: "40HP compact tractor with front loader and rotary tiller. Ready for small farms and land preparation.",
    category: "Agriculture Equipment",
    location: "Sylhet",
    price: 9800,
    rentalType: "Daily",
    availableQuantity: 1,
    condition: "Good",
    brand: "Kubota",
    model: "L3901",
    image: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=85",
    tags: ["tractor", "farming", "front loader"],
    rentalTerms: ["Operator included", "Fuel charged as used", "Transport within 20 km included"],
  },
  {
    name: "MacBook Pro 16\" Studio Setup",
    description: "M4 Pro MacBook with 27-inch monitor, keyboard, and mouse for editing, development, and design sprints.",
    category: "Electronics",
    location: "Dhaka",
    price: 3500,
    rentalType: "Weekly",
    availableQuantity: 4,
    condition: "Excellent",
    brand: "Apple",
    model: "MacBook Pro M4 Pro",
    image: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=85",
    tags: ["laptop", "editing", "monitor included"],
    rentalTerms: ["Software must be licensed by renter", "Data wiped after return", "Late returns charged per day"],
  },
  {
    name: "LED Stage & Sound Package",
    description: "Complete event package with LED wall, speakers, mixer, microphones, and lighting rig. Setup support included.",
    category: "Event Equipment",
    location: "Dhaka",
    price: 28000,
    rentalType: "Daily",
    availableQuantity: 2,
    condition: "Excellent",
    brand: "dB Technologies",
    model: "Event Pro 5000",
    image: "https://images.unsplash.com/photo-1511795409834-ef04bbd61622?auto=format&fit=crop&w=1200&q=85",
    tags: ["event", "sound", "led wall"],
    rentalTerms: ["Technician required for setup", "Venue access must be confirmed", "Cable management included"],
  },
  {
    name: "Bosch Breaker & Drill Combo",
    description: "Heavy-duty demolition breaker, rotary hammer, and core drill kit for renovation and concrete work.",
    category: "Construction Equipment",
    location: "Gazipur",
    price: 2200,
    rentalType: "Daily",
    availableQuantity: 6,
    condition: "Good",
    brand: "Bosch",
    model: "GBH 5-40 DCE",
    image: "https://images.unsplash.com/photo-1504148455328-c376907d081c?auto=format&fit=crop&w=1200&q=85",
    tags: ["drill", "demolition", "renovation"],
    rentalTerms: ["Safety equipment required", "Bits and accessories included", "Clean before return"],
  },
  {
    name: "Canon EOS R5 Portrait Kit",
    description: "Mirrorless portrait kit with 85mm lens, softbox, and reflectors for studio and outdoor sessions.",
    category: "Photography Equipment",
    location: "Chattogram",
    price: 3200,
    rentalType: "Daily",
    availableQuantity: 3,
    condition: "Excellent",
    brand: "Canon",
    model: "EOS R5",
    image: "https://images.unsplash.com/photo-1519183071298-a2962feb14f4?auto=format&fit=crop&w=1200&q=85",
    tags: ["camera", "portrait", "studio"],
    rentalTerms: ["Deposit required", "No flash use near fragile items", "Return with lens caps"],
  },
  {
    name: "Scooter Delivery Fleet",
    description: "Fuel-efficient delivery scooters with helmets and cargo boxes for courier and last-mile operations.",
    category: "Vehicles & Transportation",
    location: "Dhaka",
    price: 1800,
    rentalType: "Daily",
    availableQuantity: 5,
    condition: "Good",
    brand: "Honda",
    model: "Click 125i",
    image: "https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=1200&q=85",
    tags: ["scooter", "delivery", "helmet included"],
    rentalTerms: ["Valid licence required", "Fuel excluded", "Helmet mandatory"],
  },
  {
    name: "Pressure Washer 3000 PSI",
    description: "Commercial pressure washer with multiple nozzles for patios, vehicles, and building facades.",
    category: "Construction Equipment",
    location: "Narayanganj",
    price: 1600,
    rentalType: "Daily",
    availableQuantity: 4,
    condition: "Excellent",
    brand: "Karcher",
    model: "HD 9/50",
    image: "https://images.unsplash.com/photo-1589939705384-5185137a7f0f?auto=format&fit=crop&w=1200&q=85",
    tags: ["cleaning", "washer", "outdoor"],
    rentalTerms: ["Water supply required", "Nozzle set included", "Return with empty tank"],
  },
  {
    name: "Harvesting & Threshing Set",
    description: "Portable harvester and thresher combo for small to medium rice fields. On-site demo included.",
    category: "Agriculture Equipment",
    location: "Rajshahi",
    price: 14500,
    rentalType: "Weekly",
    availableQuantity: 2,
    condition: "Good",
    brand: "Yanmar",
    model: "AGV-450",
    image: "https://images.unsplash.com/photo-1592982537447-7440770cbfc9?auto=format&fit=crop&w=1200&q=85",
    tags: ["harvester", "farming", "rice"],
    rentalTerms: ["Operator included", "Field conditions must be confirmed", "Fuel charged as used"],
  },
  {
    name: "Portable PA & Projector Kit",
    description: "Compact projector, wireless microphones, and PA speakers for workshops, classes, and small events.",
    category: "Event Equipment",
    location: "Khulna",
    price: 2400,
    rentalType: "Daily",
    availableQuantity: 3,
    condition: "Excellent",
    brand: "JBL",
    model: "Portable PA 200",
    image: "https://images.unsplash.com/photo-1598488035139-bdbb2231ce04?auto=format&fit=crop&w=1200&q=85",
    tags: ["projector", "microphone", "workshop"],
    rentalTerms: ["HDMI and USB-C adapters included", "Power connection required", "Return in original case"],
  },
];

function daysAgo(days) {
  return new Date(Date.now() - days * 86_400_000);
}

async function ensureConfiguredAdmin(database) {
  if (!config.adminEmail || !config.adminPassword) return null;

  const users = database.collection("users");
  const passwordHash = await bcrypt.hash(config.adminPassword, 12);
  const now = new Date();
  const existing = await users.findOne({ email: config.adminEmail });

  if (existing) {
    await users.updateOne(
      { _id: existing._id },
      {
        $set: {
          name: existing.name || "Administrator",
          role: "admin",
          passwordHash,
          provider: "password",
          disabled: false,
          updatedAt: now,
        },
      },
    );
    return users.findOne({ _id: existing._id });
  }

  const admin = {
    name: "Administrator",
    email: config.adminEmail,
    passwordHash,
    photo: "",
    role: "admin",
    phone: "",
    address: "",
    provider: "password",
    createdAt: now,
    updatedAt: now,
  };
  const result = await users.insertOne(admin);
  return { ...admin, _id: result.insertedId };
}

async function ensureDemoOwner(database) {
  const users = database.collection("users");
  const existing = await users.findOne({ email: DEMO_OWNER_EMAIL });
  if (existing) return existing;

  const owner = {
    name: "Fieldkit Verified Owner",
    email: DEMO_OWNER_EMAIL,
    photo: "",
    role: "owner",
    phone: "+880 1700 000000",
    address: "Dhaka, Bangladesh",
    provider: "seed",
    createdAt: daysAgo(120),
    updatedAt: daysAgo(120),
  };
  const result = await users.insertOne(owner);
  return { ...owner, _id: result.insertedId };
}

async function seedCatalog(database) {
  const equipment = database.collection("equipment");
  if (await equipment.countDocuments({}, { limit: 1 })) return 0;

  const owner = await ensureDemoOwner(database);
  const items = SAMPLE_EQUIPMENT.map((item, index) => ({
    ...item,
    ownerId: owner._id,
    status: "approved",
    createdAt: daysAgo(90 - index * 5),
    updatedAt: daysAgo(90 - index * 5),
  }));
  await equipment.insertMany(items);
  return items.length;
}

module.exports = { ensureConfiguredAdmin, seedCatalog, SAMPLE_EQUIPMENT, DEMO_OWNER_EMAIL };
