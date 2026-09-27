import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Center, useGLTF } from '@react-three/drei'
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

useGLTF.setDecoderPath('/draco/')

type GlassBrainProps = {
  reduceMotion: boolean
  scrollBoost: number
}

/**
 * Anatomical brain only — no nerves/vessels (CC BY-SA 4.0 — Z-Anatomy / BodyParts3D).
 */
function GlassBrain({ reduceMotion, scrollBoost }: GlassBrainProps) {
  const group = useRef<THREE.Group>(null)
  const pointer = useRef({ x: 0, y: 0 })
  const spin = useRef(0)
  const boostRef = useRef(scrollBoost)
  const { scene } = useGLTF('/models/brain.glb', true)

  useEffect(() => {
    boostRef.current = scrollBoost
  }, [scrollBoost])

  const brain = useMemo(() => {
    const root = new THREE.Group()
    const tissueMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#e4d8f5'),
      metalness: 0.4,
      roughness: 0.16,
      envMapIntensity: 1.4,
    })

    const skip =
      /arter|vein|vessel|sinus|communicating|nerve|plexus|carotid|basilar|aorta|jugular|circle|willis|anastom|capillar/i

    scene.traverse((obj) => {
      if (!(obj as THREE.Mesh).isMesh) return
      const mesh = obj as THREE.Mesh
      const geo = mesh.geometry as THREE.BufferGeometry
      const verts = geo.getAttribute('position')?.count ?? 0
      const label = `${mesh.name} ${mesh.parent?.name ?? ''}`

      if (verts < 3000 || skip.test(label)) return

      const part = mesh.clone()
      part.material = tissueMat
      part.castShadow = false
      part.receiveShadow = false
      part.frustumCulled = true
      mesh.updateWorldMatrix(true, false)
      part.matrix.copy(mesh.matrixWorld)
      part.matrix.decompose(part.position, part.quaternion, part.scale)
      part.matrixAutoUpdate = true
      root.add(part)
    })

    return root
  }, [scene])

  useFrame((state, delta) => {
    if (!group.current || reduceMotion) return
    pointer.current.x = THREE.MathUtils.lerp(pointer.current.x, state.pointer.x * 0.18, 0.035)
    pointer.current.y = THREE.MathUtils.lerp(pointer.current.y, state.pointer.y * 0.12, 0.035)

    const baseSpeed = 0.55
    const speed = baseSpeed * (1 + boostRef.current * 1.35)
    spin.current += delta * speed

    group.current.rotation.y = Math.PI * 0.1 + spin.current + pointer.current.x
    group.current.rotation.x = 0.12 + pointer.current.y * 0.16
  })

  return (
    <group ref={group} position={[0, 0, 0]}>
      <Center>
        <group scale={10.98}>
          <primitive object={brain} />
        </group>
      </Center>
    </group>
  )
}

function AdaptiveDpr() {
  const { gl } = useThree()
  useEffect(() => {
    const max = Math.min(window.devicePixelRatio, 1.25)
    gl.setPixelRatio(max)
  }, [gl])
  return null
}

function LocalEnvironment() {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl)
    const background = new RoomEnvironment()
    const envMap = pmrem.fromScene(background, 0.04).texture
    scene.environment = envMap
    scene.environmentIntensity = 0.5
    return () => {
      scene.environment = null
      envMap.dispose()
      pmrem.dispose()
    }
  }, [gl, scene])

  return null
}

function Scene({
  reduceMotion,
  scrollBoost,
}: {
  reduceMotion: boolean
  scrollBoost: number
}) {
  return (
    <>
      <AdaptiveDpr />
      <ambientLight intensity={0.32} color="#c4b5fd" />
      <directionalLight position={[4, 5, 3]} intensity={1.25} color="#f5f0ff" />
      <directionalLight position={[-3, 1, -2]} intensity={0.55} color="#8b5cf6" />
      <pointLight position={[1.5, 1.2, 2.5]} intensity={0.85} color="#d4c4f5" />
      <pointLight position={[-1, -1.5, 1]} intensity={0.4} color="#7c3aed" />
      <GlassBrain reduceMotion={reduceMotion} scrollBoost={scrollBoost} />
      <LocalEnvironment />
    </>
  )
}

function usePrefersReducedMotion() {
  return useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
}

type AbstractBrainSceneProps = {
  scrollBoost?: number
}

export function AbstractBrainScene({ scrollBoost = 0 }: AbstractBrainSceneProps) {
  const reduceMotion = usePrefersReducedMotion()
  const hostRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(true)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting && entry.intersectionRatio > 0.05),
      { threshold: [0, 0.05, 0.2] },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={hostRef} className="absolute inset-0" aria-hidden>
      <Canvas
        className="h-full w-full"
        dpr={1}
        frameloop={active ? 'always' : 'never'}
        camera={{ position: [0, 0.05, 3.9], fov: 36 }}
        gl={{
          antialias: false,
          alpha: true,
          powerPreference: 'high-performance',
          stencil: false,
          depth: true,
        }}
        performance={{ min: 0.5 }}
      >
        <Suspense fallback={null}>
          <Scene reduceMotion={reduceMotion} scrollBoost={scrollBoost} />
        </Suspense>
      </Canvas>
    </div>
  )
}

useGLTF.preload('/models/brain.glb', true)
