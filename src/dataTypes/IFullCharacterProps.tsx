interface IAttack {
  name: string,
  type: string,
  range: number,
  weight: number,
  cost: number,
  effect1: string,
  effect2: string,
}

interface ISuperpower {
  name: string,
  type: string,
  cost: number,
  effect: string,
}

export interface IFullCharacterProps {
  name: string,
  alterEgo: string,
  affiliiations: string[],
  cp: number,
  cost: number,

  healthyCardImage: string,
  healthyHp: number,
  healthyMovement: string,
  healthySize: number,
  healthyPhysicalDefense: number,
  healthyEnergyDefense: number,
  healthyMysticDefense: number,
  healthyAttack1: IAttack,
  healthyAttack2: IAttack,
  healthyAttack3: IAttack,
  healthyAttack4: IAttack,
  healthySuperpower1: ISuperpower,
  healthySuperpower2: ISuperpower,
  healthySuperpower3: ISuperpower,
  healthySuperpower4: ISuperpower,
  healthySuperpower5: ISuperpower,
  healthySuperpower6: ISuperpower,

  injuredCardImage: string,
  injuredHp: number,
  injuredMovement: string,
  injuredSize: number,
  injuredPhysicalDefense: number,
  injuredEnergyDefense: number,
  injuredMysticDefense: number,
  injuredAttack1: IAttack,
  injuredAttack2: IAttack,
  injuredAttack3: IAttack,
  injuredAttack4: IAttack,
  injuredSuperpower1: ISuperpower,
  injuredSuperpower2: ISuperpower,
  injuredSuperpower3: ISuperpower,
  injuredSuperpower4: ISuperpower,
  injuredSuperpower5: ISuperpower,
  injuredSuperpower6: ISuperpower,
};