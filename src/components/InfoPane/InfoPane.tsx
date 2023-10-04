import { useState } from 'react';
import { ICharacterCardProps } from '../../dataTypes/ICharacterCardProps';
import { Image } from '../../styles/GlobalStyle';
import { Card, CardContent, CardHeader, Typography } from '@mui/material';

export function InfoPane(props: { card: ICharacterCardProps | null }) {
  const [showInjured, setShowInjured] = useState(false);

  const handleClick = () => {
    setShowInjured(!showInjured);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <Image
        src={
          props.card
            ? showInjured
              ? require('../../../assets/characterCardImages/' + props.card.cardImage2)
              : require('../../../assets/characterCardImages/' + props.card.cardImage1)
            : require('../../../assets/characterCardImages/Placeholder.png')
        }
        style={{ cursor: 'pointer' }}
        onClick={handleClick}
      />
      <Card variant="outlined" style={{ margin: '1.5em' }}>
        {!props.card ? (
          <CardHeader title="No Card Selected" />
        ) : (
          <CardContent>
            <Typography variant="h5">{props.card.name + ' \u2014 ' + props.card.alterEgo}</Typography>
            <Typography variant="body2" color="text.secondary">
              {props.card.type}
            </Typography>
            <Typography variant="body2" color="text.primary">
              Affiliations: {props.card.affiliations.join(', ')}
            </Typography>
            <Typography variant="body2" color="text.primary">
              Physical: {showInjured ? props.card.injuredPhysicalDefense : props.card.healthyPhysicalDefense} / Energy:{' '}
              {showInjured ? props.card.injuredEnergyDefense : props.card.healthyEnergyDefense} / Mystic:{' '}
              {showInjured ? props.card.injuredMysticDefense : props.card.healthyMysticDefense}
            </Typography>
            <Typography variant="body2" color="text.primary">
              HP: {showInjured ? props.card.injuredHp : props.card.healthyHp} / Cost: {props.card.cost} / Size:{' '}
              {showInjured ? props.card.injuredSize : props.card.healthySize} / Movement:{' '}
              {showInjured ? props.card.injuredMovement : props.card.healthyMovement}
            </Typography>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
